import fs from 'node:fs'
import path from 'node:path'
import { ResolverFactory } from 'oxc-resolver'
import { fileId } from '../shared/schema.ts'
import type { Edge, Manifest } from '../shared/schema.ts'
import { matchesRoute } from './analyzers/http.ts'
import { jsTsAnalyzer } from './analyzers/js-ts.ts'
import type { Analyzer, FileAnalysis } from './analyzers/types.ts'

export type UnmatchedCall = { file: string, method: string, path: string }

export type EdgeResult = { edges: Edge[], unmatchedCalls: UnmatchedCall[] }

type FileStamp = { path: string, mtimeMs: number, size: number }

type EdgeIndex = { update(files: FileStamp[], manifest: Manifest | undefined): EdgeResult }

type CachedFile = { mtimeMs: number, size: number, analysis: FileAnalysis, importTargets?: string[] }

const analyzers: Analyzer[] = [jsTsAnalyzer]

const resolverConfigFile = /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json)$/

// Larger files are bundles or generated code and take most of the parse time
const maxSourceBytes = 1024 * 1024

export function createEdgeIndex(repoRoot: string): EdgeIndex {
    const rootDir = fs.realpathSync.native(repoRoot)
    const resolver = new ResolverFactory({
        tsconfig: 'auto',
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
        extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] },
        conditionNames: ['types', 'import', 'require', 'node', 'default'],
    })
    const cache = new Map<string, CachedFile>()
    let resolverInputs = ''

    // The resolver caches file lookups and tsconfigs, so an added, removed or reconfigured file makes it stale
    function refreshResolver(files: FileStamp[]): void {
        const inputs = files
            .map((file) => resolverConfigFile.test(file.path) ? `${file.path} ${file.mtimeMs} ${file.size}` : file.path)
            .join('\n')
        if (inputs === resolverInputs) return
        resolver.clearCache()
        resolverInputs = inputs
        for (const cached of cache.values()) cached.importTargets = undefined
    }

    function findImportEdges(filePaths: Set<string>): Edge[] {
        const edges: Edge[] = []
        for (const [fromPath, cached] of cache) {
            cached.importTargets ??= cached.analysis.imports
                .flatMap((specifier) => resolveImport(fromPath, specifier) ?? [])
            for (const target of cached.importTargets) {
                if (filePaths.has(target)) edges.push({ from: fileId(fromPath), to: fileId(target), kind: 'import' })
            }
        }
        return edges
    }

    function resolveImport(fromPath: string, specifier: string): string | undefined {
        const resolved = resolver.resolveFileSync(path.join(rootDir, fromPath), specifier).path
        if (!resolved) return undefined
        const relative = path.relative(rootDir, resolved)
        const segments = relative.split(path.sep)
        const isInsideRepo = !path.isAbsolute(relative) && segments[0] !== '..'
        return isInsideRepo && !segments.includes('node_modules') ? segments.join('/') : undefined
    }

    return {
        update(files, manifest) {
            refreshCache(rootDir, files, cache)
            refreshResolver(files)
            const importEdges = findImportEdges(new Set(files.map((file) => file.path)))
            const http = findHttpEdges(cache)
            return {
                edges: unique([...importEdges, ...http.edges, ...manualEdges(manifest)]),
                unmatchedCalls: unique(http.unmatchedCalls),
            }
        },
    }
}

function refreshCache(rootDir: string, files: FileStamp[], cache: Map<string, CachedFile>): void {
    const analyzedPaths = new Set<string>()
    for (const file of files) {
        const analyzer = analyzers.find((candidate) => candidate.match(file.path))
        if (!analyzer || file.size > maxSourceBytes) continue
        const cached = cache.get(file.path)
        if (cached?.mtimeMs !== file.mtimeMs || cached.size !== file.size) {
            const source = readSource(path.join(rootDir, file.path))
            if (source === undefined) continue
            const analysis = analyzer.analyze(file.path, source)
            cache.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, analysis })
        }
        analyzedPaths.add(file.path)
    }
    for (const cachedPath of cache.keys()) {
        if (!analyzedPaths.has(cachedPath)) cache.delete(cachedPath)
    }
}

function readSource(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, 'utf8')
    } catch {
        return undefined
    }
}

function findHttpEdges(cache: Map<string, CachedFile>): EdgeResult {
    const routes = [...cache].flatMap(([file, { analysis }]) => analysis.routes.map((route) => ({ file, route })))
    const edges: Edge[] = []
    const unmatchedCalls: UnmatchedCall[] = []
    for (const [file, { analysis }] of cache) {
        for (const call of analysis.calls) {
            const matches = routes.filter(({ route }) => matchesRoute(call, route))
            if (matches.length === 0) unmatchedCalls.push({ file, ...call })
            for (const match of matches) {
                const label = `${call.method} ${match.route.path}`
                edges.push({ from: fileId(file), to: fileId(match.file), kind: 'http', label })
            }
        }
    }
    return { edges, unmatchedCalls }
}

function manualEdges(manifest: Manifest | undefined): Edge[] {
    return (manifest?.httpEdges ?? []).map(({ from, to, note }): Edge => (
        note === undefined ? { from, to, kind: 'http' } : { from, to, kind: 'http', label: note }
    ))
}

// Every edge and call is built here with the same key order, so equal items serialize equally
function unique<T>(items: T[]): T[] {
    return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
}
