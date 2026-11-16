import path from 'node:path'
import type { z } from 'zod'
import { bugsFileSchema, layoutFileSchema, manifestSchema, ROOT_ID } from '../shared/schema.ts'
import type { Edge, Manifest, PinRequest, Snapshot, TreeNode } from '../shared/schema.ts'
import { resolveBugs } from './bugs.ts'
import { buildTree, checkManifest, treeIds } from './components.ts'
import { createEdgeIndex } from './edges.ts'
import type { EdgeIndex } from './edges.ts'
import { listCommits, resolveCommit, withCommitTree } from './history.ts'
import { createInventory, listRepoFiles } from './inventory.ts'
import type { InventoryFile } from './inventory.ts'
import { configDir, errorMessage, readJsonFile, writeJsonFile } from './json-file.ts'

export type SnapshotSource = {
    rescan(): Promise<Snapshot>
    setPin(request: PinRequest): void
    // Resolves undefined when the repo has no such commit
    snapshotAt(commit: string): Promise<Snapshot | undefined>
}

type MapView = {
    root: TreeNode
    edges: Edge[]
    nodeIds: Set<string>
}

type LastValidReader<T> = (errors: string[]) => T | undefined

const commitViewLimit = 20

export function createSnapshotSource(repoRoot: string, options: { trackedOnly: boolean }): SnapshotSource {
    const repoName = path.basename(repoRoot)
    const configRoot = path.join(repoRoot, configDir)
    const layoutPath = path.join(configRoot, 'layout.json')
    const inventory = createInventory(repoRoot, () => listRepoFiles(repoRoot, options.trackedOnly))
    const edgeIndex = createEdgeIndex(repoRoot)
    const readManifest = createLastValidReader(path.join(configRoot, 'components.json'), manifestSchema, checkManifest)
    const readBugs = createLastValidReader(path.join(configRoot, 'bugs.json'), bugsFileSchema)
    const readLayout = createLastValidReader(layoutPath, layoutFileSchema)
    let lastBuilt = emptySnapshot(repoName)
    let running: Promise<Snapshot> | undefined
    let queued: Promise<Snapshot> | undefined
    const commitViews = new Map<string, Promise<MapView>>()
    let lastCheckout: Promise<unknown> = Promise.resolve()

    async function build(): Promise<Snapshot> {
        const errors: string[] = []
        const manifest = readManifest(errors)
        const bugsFile = readBugs(errors)
        const layout = readLayout(errors)
        const [files, commits] = await Promise.all([inventory.scan(manifest?.ignore ?? []), listCommits(repoRoot)])
        const { root, edges, nodeIds } = await mapFiles(repoName, files, edgeIndex, manifest)
        const { bugs, errors: bugErrors } = resolveBugs(bugsFile, nodeIds)
        errors.push(...bugErrors)
        return { root, edges, bugs, pins: layout?.pins ?? {}, errors, generatedAt: new Date().toISOString(), commits }
    }

    async function buildOrKeepLast(): Promise<Snapshot> {
        try {
            lastBuilt = await build()
            return lastBuilt
        } catch (error) {
            const message = `Rescan failed: ${errorMessage(error)}`
            return { ...lastBuilt, errors: [...lastBuilt.errors, message], generatedAt: new Date().toISOString() }
        }
    }

    // Calls during a running scan share one follow-up scan, so scans never overlap
    function rescan(): Promise<Snapshot> {
        if (!running) {
            running = buildOrKeepLast().finally(() => {
                running = undefined
            })
            return running
        }
        queued ??= running.then(() => {
            queued = undefined
            return rescan()
        })
        return queued
    }

    function setPin({ id, pin }: PinRequest): void {
        const pins = Object.entries(readLayout([])?.pins ?? {}).filter(([pinnedId]) => pinnedId !== id)
        if (pin) pins.push([id, pin])
        writeJsonFile(layoutPath, { version: 1, pins: Object.fromEntries(pins) })
    }

    // Keyed by the manifest too, since past commits are named with the current one
    function viewAt(sha: string, manifest: Manifest | undefined): Promise<MapView> {
        const key = JSON.stringify([sha, manifest ?? null])
        const cached = commitViews.get(key)
        if (cached) return cached
        // One checkout at a time, so a quick run through the commit list cannot pile up full checkouts and parses
        const view = lastCheckout.then(() => withCommitTree(repoRoot, sha, async (treeDir, paths) => {
            const files = await createInventory(treeDir, async () => paths).scan(manifest?.ignore ?? [])
            return mapFiles(repoName, files, createEdgeIndex(treeDir, repoRoot), manifest)
        }))
        lastCheckout = view.catch(() => undefined)
        commitViews.set(key, view)
        view.catch(() => commitViews.delete(key))
        if (commitViews.size > commitViewLimit) {
            const [oldest] = commitViews.keys()
            commitViews.delete(oldest)
        }
        return view
    }

    async function snapshotAt(commit: string): Promise<Snapshot | undefined> {
        const sha = await resolveCommit(repoRoot, commit)
        if (!sha) return undefined
        const errors: string[] = []
        const manifest = readManifest(errors)
        const { root, edges } = await viewAt(sha, manifest)
        const pins = readLayout([])?.pins ?? {}
        return { root, edges, bugs: [], pins, errors, generatedAt: new Date().toISOString(), commits: [], commit: sha }
    }

    return { rescan, setPin, snapshotAt }
}

async function mapFiles(
    repoName: string,
    files: InventoryFile[],
    edgeIndex: EdgeIndex,
    manifest: Manifest | undefined,
): Promise<MapView> {
    const root = buildTree(repoName, files, manifest)
    const nodeIds = treeIds(root)
    // A manual http edge can name a component that has no files and so no node
    const edges = (await edgeIndex.update(files, manifest)).edges
        .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    return { root, edges, nodeIds }
}

// An invalid file keeps its last valid value in use while its errors are reported
function createLastValidReader<T>(
    filePath: string,
    schema: z.ZodType<T>,
    check: (value: T) => string[] = () => [],
): LastValidReader<T> {
    let lastValid: T | undefined
    return (errors) => {
        const result = readJsonFile(filePath, schema)
        if (result.status === 'missing') {
            lastValid = undefined
            return lastValid
        }
        const problems = result.status === 'ok' ? check(result.value) : result.errors
        errors.push(...problems)
        if (result.status === 'ok' && problems.length === 0) lastValid = result.value
        return lastValid
    }
}

function emptySnapshot(repoName: string): Snapshot {
    return {
        root: { id: ROOT_ID, kind: 'dir', label: repoName, path: '', children: [] },
        edges: [],
        bugs: [],
        pins: {},
        errors: [],
        generatedAt: new Date().toISOString(),
        commits: [],
    }
}
