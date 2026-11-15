import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { bugsFileSchema, layoutFileSchema, manifestSchema, ROOT_ID } from '../shared/schema.ts'
import type { PinRequest, Snapshot } from '../shared/schema.ts'
import { resolveBugs } from './bugs.ts'
import { buildTree, checkManifest, treeIds } from './components.ts'
import { createEdgeIndex } from './edges.ts'
import { createInventory } from './inventory.ts'
import { configDir, errorMessage, formatJson, readJsonFile } from './json-file.ts'

export type SnapshotSource = {
    rescan(): Promise<Snapshot>
    setPin(request: PinRequest): void
}

type LastValidReader<T> = (errors: string[]) => T | undefined

export function createSnapshotSource(repoRoot: string, options: { trackedOnly: boolean }): SnapshotSource {
    const repoName = path.basename(repoRoot)
    const configRoot = path.join(repoRoot, configDir)
    const layoutPath = path.join(configRoot, 'layout.json')
    const inventory = createInventory(repoRoot, options)
    const edgeIndex = createEdgeIndex(repoRoot)
    const readManifest = createLastValidReader(path.join(configRoot, 'components.json'), manifestSchema, checkManifest)
    const readBugs = createLastValidReader(path.join(configRoot, 'bugs.json'), bugsFileSchema)
    const readLayout = createLastValidReader(layoutPath, layoutFileSchema)
    let lastBuilt = emptySnapshot(repoName)
    let running: Promise<Snapshot> | undefined
    let queued: Promise<Snapshot> | undefined

    async function build(): Promise<Snapshot> {
        const errors: string[] = []
        const manifest = readManifest(errors)
        const bugsFile = readBugs(errors)
        const layout = readLayout(errors)
        const files = await inventory.scan(manifest?.ignore ?? [])
        const root = buildTree(repoName, files, manifest)
        const nodeIds = treeIds(root)
        // A manual http edge can name a component that has no files and so no node
        const edges = (await edgeIndex.update(files, manifest)).edges
            .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
        const { bugs, errors: bugErrors } = resolveBugs(bugsFile, nodeIds)
        errors.push(...bugErrors)
        return { root, edges, bugs, pins: layout?.pins ?? {}, errors, generatedAt: new Date().toISOString(), commits: [] }
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

    return { rescan, setPin }
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

function writeJsonFile(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tempPath, formatJson(value))
    fs.renameSync(tempPath, filePath)
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
