#!/usr/bin/env node
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildTree, flattenTree, listComponents } from '../server/components.ts'
import { createEdgeIndex } from '../server/edges.ts'
import type { UnmatchedCall } from '../server/edges.ts'
import { startServer } from '../server/index.ts'
import { compareStrings, findRepoRoot } from '../server/inventory.ts'
import { configDir, errorMessage, formatJson } from '../server/json-file.ts'
import type { JsonFileResult } from '../server/json-file.ts'
import { findPackageRoot } from '../server/package-root.ts'
import { fileId, ownFilesId } from '../shared/schema.ts'
import type { Edge, FileRef, Manifest, TreeNode } from '../shared/schema.ts'
import { openInBrowser, recordServer, startBackgroundServer, stopBackgroundServer } from './background.ts'
import { bugUsage, runBugCommand } from './bugs.ts'
import { findErrors, loadRepo, unmappedPaths } from './repo.ts'

const defaultPort = 4747
const listLimit = 200
const importPairLimit = 30
const commands = new Set(['serve', 'up', 'down', 'init', 'summary', 'validate', 'bug'])

const usage = `Usage: dev-bubbles [command] [repo] [options]

Commands:
    serve           Serve the live map in the foreground (default)
    up              Start the map server in the background unless it already runs, and print its URL
    down            Stop the background map server
    init            Set up ${configDir}/ and the Claude Code commands in the repo
    summary         Print a compact overview of the repo for a coding agent
    validate        Check components.json and bugs.json, exit 1 on any error
    bug             Record a bug on the map, see below

${bugUsage}

Options:
    --repo <path>   Repository when [repo] is not given (default: $DEV_BUBBLES_REPO or the current directory)
    --port <n>      Port for serve, 0 picks a free one (default: ${defaultPort}, or a free one when it is busy)
    --open          Open the map in the browser (up)
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
                port: { type: 'string' },
                open: { type: 'boolean', default: false },
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

async function serve(repo: string, port: number | undefined, trackedOnly: boolean): Promise<void> {
    try {
        const repoRoot = await findRepoRoot(repo)
        const server = await startServer({ repo: repoRoot, port: port ?? defaultPort, trackedOnly }).catch((error: unknown) => {
            if (port !== undefined || !isAddressInUse(error)) throw error
            return startServer({ repo: repoRoot, port: 0, trackedOnly })
        })
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
        recordServer(repoRoot, url)
        console.log(`Dev Bubbles serving ${repo} at ${url}`)
    } catch (error) {
        fail(isAddressInUse(error) ? `Port ${port} is already in use, pick another with --port <n>` : errorMessage(error))
    }
}

async function up(repoRoot: string, open: boolean): Promise<void> {
    const url = await startBackgroundServer(repoRoot)
    console.log(url)
    if (open) openInBrowser(url)
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
        '  2. Run /map in Claude Code to group the files into named components',
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

async function summarize(repoRoot: string, trackedOnly: boolean): Promise<string> {
    const { manifestResult, manifest, files, root } = await loadRepo(repoRoot, trackedOnly)
    const { edges, unmatchedCalls } = await createEdgeIndex(repoRoot).update(files, manifest)
    return [
        `${path.basename(repoRoot)}: ${countOf(files.length, 'file')}, ${sumLoc(files)} LOC`,
        section('Directories:', describeDirectories(buildTree('', files, undefined))),
        section('Top cross-directory imports (importing dir -> imported dir: count):', describeImportPairs(edges)),
        section('Components (id, label: files):', describeComponents(manifestResult, root)),
        section(
            'Components with both sub-components and own files (own files show as an extra leaf named after the component, move them into a sub-component):',
            capList(describeOwnFiles(root)),
        ),
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
    return (node.children ?? []).filter((child) => child.id !== ownFilesId(node.id)).flatMap((dir) => {
        const dirFiles = fileRefs(dir)
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
        return `${'  '.repeat(depth)}${def.id}, ${def.label}: ${node ? fileRefs(node).length : 0}`
    })
}

function describeOwnFiles(root: TreeNode): string[] {
    return flattenTree(root).flatMap((node) => {
        const ownFiles = node.children?.find((child) => child.id === ownFilesId(node.id))?.files
        if (node.kind !== 'component' || !ownFiles) return []
        return [`${node.id}, ${node.label}: ${countOf(ownFiles.length, 'file')}`, ...ownFiles.map((file) => `  ${file.path}`)]
    })
}

function describeCall(call: UnmatchedCall): string {
    return `${call.file}  ${call.method} ${call.path}`
}

function fileRefs(node: TreeNode): FileRef[] {
    return flattenTree(node).flatMap((child) => child.files ?? [])
}

function countOf(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function sumLoc(items: FileRef[]): number {
    return items.reduce((total, item) => total + item.loc, 0)
}

function directoryOf(nodeId: string): string {
    return path.posix.dirname(nodeId.slice(fileId('').length))
}

/* Validate */

async function validate(repoRoot: string, trackedOnly: boolean): Promise<number> {
    const errors = await findErrors(repoRoot, trackedOnly)
    const verdict = errors.length === 0 ? 'OK' : countOf(errors.length, 'error')
    console.log([...capList(errors), verdict].join('\n'))
    return errors.length === 0 ? 0 : 1
}

/* Main */

const { values, positionals } = readArgs()

if (values.help) {
    console.log(usage)
    process.exit(0)
}

const [command = 'serve', ...args] = positionals
if (!commands.has(command)) fail(`Unknown command: ${command}\n\n${usage}`)

const repoArg = command === 'bug' ? undefined : args[0]
if (command !== 'bug' && args.length > 1) fail(`Unexpected arguments: ${args.slice(1).join(' ')}\n\n${usage}`)

const repo = path.resolve(repoArg ?? values.repo ?? process.env.DEV_BUBBLES_REPO ?? process.cwd())
if (!fs.statSync(repo, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Not a directory: ${repo}`)
}

const trackedOnly = values['tracked-only']

if (command === 'serve') {
    await serve(repo, values.port === undefined ? undefined : parsePort(values.port), trackedOnly)
} else {
    try {
        const repoRoot = await findRepoRoot(repo)
        if (command === 'init') init(repoRoot)
        else if (command === 'up') await up(repoRoot, values.open)
        else if (command === 'down') console.log(await stopBackgroundServer(repoRoot))
        else if (command === 'bug') console.log(await runBugCommand(repoRoot, args))
        else if (command === 'summary') console.log(await summarize(repoRoot, trackedOnly))
        else process.exitCode = await validate(repoRoot, trackedOnly)
    } catch (error) {
        fail(errorMessage(error))
    }
}
