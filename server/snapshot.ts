import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { bugsFileSchema, layoutFileSchema, manifestSchema, ROOT_ID } from '../shared/schema.ts'
import type { PinRequest, Snapshot } from '../shared/schema.ts'
import { resolveBugs } from './bugs.ts'
import { buildTree, checkManifest } from './components.ts'
import { createEdgeIndex } from './edges.ts'
import { createInventory } from './inventory.ts'
import { readJsonFile } from './json-file.ts'

export type SnapshotSource = {
    rescan(): Promise<Snapshot>
    setPin(request: PinRequest): void
}

type LastValidReader<T> = (errors: string[]) => T | undefined

export function createSnapshotSource(repoRoot: string, options: { trackedOnly: boolean }): SnapshotSource {
    const repoName = path.basename(repoRoot)
    const configDir = path.join(repoRoot, '.dev-bubbles')
    const layoutPath = path.join(configDir, 'layout.json')
    const inventory = createInventory(repoRoot, options)
    const edgeIndex = createEdgeIndex(repoRoot)
    const readManifest = createLastValidReader(path.join(configDir, 'components.json'), manifestSchema)
    const readBugs = createLastValidReader(path.join(configDir, 'bugs.json'), bugsFileSchema)
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
        if (manifest) errors.push(...checkManifest(manifest))
        const { edges } = edgeIndex.update(files, manifest)
        const { bugs, errors: bugErrors } = resolveBugs(bugsFile, root)
        errors.push(...bugErrors)
        return { root, edges, bugs, pins: layout?.pins ?? {}, errors, generatedAt: new Date().toISOString() }
    }

    async function buildOrKeepLast(): Promise<Snapshot> {
        try {
            lastBuilt = await build()
            return lastBuilt
        } catch (error) {
            const message = `Rescan failed: ${error instanceof Error ? error.message : String(error)}`
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
function createLastValidReader<T>(filePath: string, schema: z.ZodType<T>): LastValidReader<T> {
    let lastValid: T | undefined
    return (errors) => {
        const result = readJsonFile(filePath, schema)
        if (result.status === 'invalid') errors.push(...result.errors)
        else lastValid = result.status === 'ok' ? result.value : undefined
        return lastValid
    }
}

function writeJsonFile(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 4)}\n`)
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
    }
}
