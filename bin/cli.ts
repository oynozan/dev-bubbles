#!/usr/bin/env node
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { resolveBugs } from '../server/bugs.ts'
import { buildTree, checkManifest, flattenTree, listComponents } from '../server/components.ts'
import { createEdgeIndex } from '../server/edges.ts'
import type { UnmatchedCall } from '../server/edges.ts'
import { startServer } from '../server/index.ts'
import { compareStrings, createInventory, findRepoRoot } from '../server/inventory.ts'
import type { InventoryFile } from '../server/inventory.ts'
import { configDir, errorMessage, formatJson, readJsonFile } from '../server/json-file.ts'
import type { JsonFileResult } from '../server/json-file.ts'
import { findPackageRoot } from '../server/package-root.ts'
import { bugsFileSchema, fileId, manifestSchema, UNMAPPED_ID } from '../shared/schema.ts'
import type { Edge, Manifest, TreeNode } from '../shared/schema.ts'

type RepoState = {
    manifestResult: JsonFileResult<Manifest>
    manifest: Manifest | undefined
    files: InventoryFile[]
    root: TreeNode
}

const defaultPort = 4747
const listLimit = 200
const importPairLimit = 30
const commands = new Set(['serve', 'init', 'summary', 'validate'])

const usage = `Usage: dev-bubbles [command] [repo] [options]

Commands:
    serve           Serve the live map (default)
    init            Set up .dev-bubbles/ and the Claude Code commands in the repo
    summary         Print a compact overview of the repo for a coding agent
    validate        Check components.json and bugs.json, exit 1 on any error

Options:
    --repo <path>   Repository when [repo] is not given (default: $DEV_BUBBLES_REPO or the current directory)
    --port <n>      Port for serve, 0 picks a free one (default: ${defaultPort})
    --tracked-only  Leave out files git does not track (serve, summary, validate)
    -h, --help      Show this help`

function fail(message: string): never {
    console.error(message)
    process.exit(1)
}

function readArgs() {
    try {
        return parseArgs({
            allowPositionals: true,
            options: {
                repo: { type: 'string' },
                port: { type: 'string', default: String(defaultPort) },
                'tracked-only': { type: 'boolean', default: false },
                help: { type: 'boolean', short: 'h' },
            },
        })
    } catch (error) {
        fail(`${errorMessage(error)}\n\n${usage}`)
    }
}

/* Serve */

function parsePort(value: string): number {
    const port = Number(value)
    if (!/^\d+$/.test(value) || port > 65535) fail(`Invalid port: ${value}`)
    return port
}

function isAddressInUse(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}

async function serve(repo: string, port: number, trackedOnly: boolean): Promise<void> {
    try {
        const server = await startServer({ repo, port, trackedOnly })
        const { port: actualPort } = server.address() as AddressInfo
        console.log(`Dev Bubbles serving ${repo} at http://127.0.0.1:${actualPort}`)
    } catch (error) {
        fail(isAddressInUse(error) ? `Port ${port} is already in use, pick another with --port <n>` : errorMessage(error))
    }
}

/* Init */

function init(repoRoot: string): void {
    const packageRoot = findPackageRoot(import.meta.dirname)
    console.log(`Setting up Dev Bubbles in ${repoRoot}`)
    createFileOnce(repoRoot, path.join(configDir, 'components.json'), formatJson({ version: 1, components: [] }))
    createFileOnce(repoRoot, path.join(configDir, 'bugs.json'), formatJson({ version: 1, bugs: [] }))
    addToGitignore(repoRoot, [`${configDir}/bugs.json`, `${configDir}/layout.json`])
    copyTemplates(path.join(packageRoot, 'templates', 'commands'), repoRoot, path.join('.claude', 'commands'), '.md')
    copyTemplates(path.join(packageRoot, 'skills', 'dev-bubbles'), repoRoot, path.join('.claude', 'skills', 'dev-bubbles'))
    console.log([
        '',
        `Paste ${path.join(packageRoot, 'templates', 'claude-snippet.md')} into the repo's CLAUDE.md`,
        '',
        'Next steps:',
        `  1. Run dev-bubbles in ${repoRoot} to open the map`,
        '  2. Run /map in Claude Code to group the files into components',
    ].join('\n'))
}

function createFileOnce(repoRoot: string, relativePath: string, content: string | Buffer): void {
    const filePath = path.join(repoRoot, relativePath)
    if (fs.existsSync(filePath)) {
        console.log(`  skipped ${relativePath}, it already exists`)
        return
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    console.log(`  created ${relativePath}`)
}

function addToGitignore(repoRoot: string, entries: string[]): void {
    const gitignorePath = path.join(repoRoot, '.gitignore')
    const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
    const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()))
    const missing = entries.filter((entry) => !lines.has(entry))
    if (missing.length === 0) return
    const eol = current.includes('\r\n') ? '\r\n' : '\n'
    const separator = current === '' || current.endsWith('\n') ? '' : eol
    fs.appendFileSync(gitignorePath, separator + missing.map((entry) => entry + eol).join(''))
    console.log(`  added ${missing.join(' and ')} to .gitignore`)
}

function copyTemplates(sourceDir: string, repoRoot: string, targetDir: string, extension = ''): void {
    const sourceFiles = fs.readdirSync(sourceDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .map((entry) => path.relative(sourceDir, path.join(entry.parentPath, entry.name)))
    for (const sourceFile of sourceFiles) {
        createFileOnce(repoRoot, path.join(targetDir, sourceFile), fs.readFileSync(path.join(sourceDir, sourceFile)))
    }
}

/* Summary */

async function loadRepo(repoRoot: string, trackedOnly: boolean): Promise<RepoState> {
    const manifestResult = readJsonFile(path.join(repoRoot, configDir, 'components.json'), manifestSchema)
    const manifest = manifestResult.status === 'ok' ? manifestResult.value : undefined
    const files = await createInventory(repoRoot, { trackedOnly }).scan(manifest?.ignore ?? [])
    return { manifestResult, manifest, files, root: buildTree(path.basename(repoRoot), files, manifest) }
}

async function summarize(repoRoot: string, trackedOnly: boolean): Promise<string> {
    const { manifestResult, manifest, files, root } = await loadRepo(repoRoot, trackedOnly)
    const { edges, unmatchedCalls } = createEdgeIndex(repoRoot).update(files, manifest)
    return [
        `${path.basename(repoRoot)}: ${countOf(files.length, 'file')}, ${sumLoc(files)} LOC`,
        section('Directories:', describeDirectories(buildTree('', files, undefined))),
        section('Top cross-directory imports (importing dir -> imported dir: count):', describeImportPairs(edges)),
        section('Components (id, label: files):', describeComponents(manifestResult, root)),
        section('Unmapped files:', manifest?.components.length ? capList(unmappedPaths(root)) : ['all files, components.json has no valid components yet']),
        section('Unmatched HTTP calls:', capList(unmatchedCalls.map(describeCall))),
    ].join('\n\n')
}

function section(title: string, lines: string[]): string {
    const body = lines.length > 0 ? lines : ['(none)']
    return [title, ...body.map((line) => `  ${line}`)].join('\n')
}

function capList(lines: string[]): string[] {
    if (lines.length <= listLimit) return lines
    return [...lines.slice(0, listLimit), `... and ${lines.length - listLimit} more`]
}

function describeDirectories(node: TreeNode, depth = 0): string[] {
    return (node.children ?? []).filter((child) => child.kind === 'dir').flatMap((dir) => {
        const dirFiles = fileNodes(dir)
        const line = `${'  '.repeat(depth)}${dir.label}/  ${countOf(dirFiles.length, 'file')}, ${sumLoc(dirFiles)} LOC`
        return [line, ...describeDirectories(dir, depth + 1)]
    })
}

function describeImportPairs(edges: Edge[]): string[] {
    const counts = new Map<string, number>()
    for (const edge of edges) {
        if (edge.kind !== 'import') continue
        const from = directoryOf(edge.from)
        const to = directoryOf(edge.to)
        const pair = `${from} -> ${to}`
        if (from !== to) counts.set(pair, (counts.get(pair) ?? 0) + 1)
    }
    return [...counts]
        .sort(([pairA, countA], [pairB, countB]) => countB - countA || compareStrings(pairA, pairB))
        .slice(0, importPairLimit)
        .map(([pair, count]) => `${pair}: ${count}`)
}

function describeComponents(manifestResult: JsonFileResult<Manifest>, root: TreeNode): string[] {
    if (manifestResult.status === 'invalid') return ['components.json is invalid, run dev-bubbles validate']
    if (manifestResult.status === 'missing' || manifestResult.value.components.length === 0) {
        return [`No components yet, write ${configDir}/components.json`]
    }
    const nodes = new Map(flattenTree(root).map((node) => [node.id, node]))
    return listComponents(manifestResult.value.components).map(({ def, depth }) => {
        const node = nodes.get(def.id)
        return `${'  '.repeat(depth)}${def.id}, ${def.label}: ${node ? fileNodes(node).length : 0}`
    })
}

function describeCall(call: UnmatchedCall): string {
    return `${call.file}  ${call.method} ${call.path}`
}

function unmappedPaths(root: TreeNode): string[] {
    const unmapped = root.children?.find((node) => node.id === UNMAPPED_ID)
    return (unmapped ? fileNodes(unmapped) : []).map((node) => node.path ?? '').toSorted()
}

function fileNodes(node: TreeNode): TreeNode[] {
    return flattenTree(node).filter((child) => child.kind === 'file')
}

function countOf(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function sumLoc(items: { loc?: number }[]): number {
    return items.reduce((total, item) => total + (item.loc ?? 0), 0)
}

function directoryOf(nodeId: string): string {
    return path.posix.dirname(nodeId.slice(fileId('').length))
}

/* Validate */

async function validate(repoRoot: string, trackedOnly: boolean): Promise<number> {
    const { manifestResult, manifest, root } = await loadRepo(repoRoot, trackedOnly)
    const bugsResult = readJsonFile(path.join(repoRoot, configDir, 'bugs.json'), bugsFileSchema)
    const errors = [
        ...(manifestResult.status === 'invalid' ? manifestResult.errors : []),
        ...(manifest ? checkManifest(manifest) : []),
        ...(manifest ? findEmptyComponents(manifest, root) : []),
        ...(bugsResult.status === 'invalid' ? bugsResult.errors : []),
        ...(bugsResult.status === 'ok' ? resolveBugs(bugsResult.value, root).errors : []),
        ...unmappedPaths(root).map((filePath) => `components.json: ${filePath} matches no component`),
    ]
    const verdict = errors.length === 0 ? 'OK' : countOf(errors.length, 'error')
    console.log([...capList(errors), verdict].join('\n'))
    return errors.length === 0 ? 0 : 1
}

function findEmptyComponents(manifest: Manifest, root: TreeNode): string[] {
    const nodeIds = new Set(flattenTree(root).map((node) => node.id))
    return listComponents(manifest.components)
        .filter(({ def }) => !nodeIds.has(def.id))
        .map(({ def, jsonPath }) => `components.json: ${jsonPath}: component ${def.id} has no files`)
}

/* Main */

const { values, positionals } = readArgs()

if (values.help) {
    console.log(usage)
    process.exit(0)
}

const [command = 'serve', repoArg, ...extraArgs] = positionals
if (!commands.has(command)) fail(`Unknown command: ${command}\n\n${usage}`)
if (extraArgs.length > 0) fail(`Unexpected arguments: ${extraArgs.join(' ')}\n\n${usage}`)

const repo = path.resolve(repoArg ?? values.repo ?? process.env.DEV_BUBBLES_REPO ?? process.cwd())
if (!fs.statSync(repo, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Not a directory: ${repo}`)
}

const trackedOnly = values['tracked-only']

if (command === 'serve') {
    await serve(repo, parsePort(values.port), trackedOnly)
} else {
    try {
        const repoRoot = await findRepoRoot(repo)
        if (command === 'init') init(repoRoot)
        else if (command === 'summary') console.log(await summarize(repoRoot, trackedOnly))
        else process.exitCode = await validate(repoRoot, trackedOnly)
    } catch (error) {
        fail(errorMessage(error))
    }
}
