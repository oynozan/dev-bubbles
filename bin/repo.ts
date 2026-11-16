import path from 'node:path'
import { resolveBugs } from '../server/bugs.ts'
import { buildTree, checkManifest, listComponents, treeIds } from '../server/components.ts'
import { createInventory, listRepoFiles } from '../server/inventory.ts'
import type { InventoryFile } from '../server/inventory.ts'
import { configDir, readJsonFile } from '../server/json-file.ts'
import type { JsonFileResult } from '../server/json-file.ts'
import { findPackageRoot } from '../server/package-root.ts'
import { bugsFileSchema, manifestSchema, UNMAPPED_ID } from '../shared/schema.ts'
import type { Manifest, TreeNode } from '../shared/schema.ts'

export type RepoState = {
    manifestResult: JsonFileResult<Manifest>
    manifest: Manifest | undefined
    files: InventoryFile[]
    root: TreeNode
}

const cliFile = path.join(findPackageRoot(import.meta.dirname), 'dist', 'bin', 'cli.js')

export async function loadRepo(repoRoot: string, trackedOnly: boolean): Promise<RepoState> {
    const manifestResult = readJsonFile(path.join(repoRoot, configDir, 'components.json'), manifestSchema)
    const manifest = manifestResult.status === 'ok' ? manifestResult.value : undefined
    const files = await createInventory(repoRoot, () => listRepoFiles(repoRoot, trackedOnly)).scan(manifest?.ignore ?? [])
    return { manifestResult, manifest, files, root: buildTree(path.basename(repoRoot), files, manifest) }
}

// Files matching no component only count once the manifest has components, before that the map shows plain folders
export async function findErrors(repoRoot: string, trackedOnly: boolean): Promise<string[]> {
    const { manifestResult, manifest, root } = await loadRepo(repoRoot, trackedOnly)
    const bugsResult = readJsonFile(path.join(repoRoot, configDir, 'bugs.json'), bugsFileSchema)
    const nodeIds = treeIds(root)
    return [
        ...(manifestResult.status === 'invalid' ? manifestResult.errors : []),
        ...(manifest ? checkManifest(manifest) : []),
        ...(manifest ? findEmptyComponents(manifest, nodeIds) : []),
        ...(bugsResult.status === 'invalid' ? bugsResult.errors : []),
        ...(bugsResult.status === 'ok' ? resolveBugs(bugsResult.value, nodeIds).errors : []),
        ...unmappedPaths(root).map((filePath) => `components.json: ${filePath} matches no component`),
    ]
}

function findEmptyComponents(manifest: Manifest, nodeIds: ReadonlySet<string>): string[] {
    return listComponents(manifest.components)
        .filter(({ def }) => !nodeIds.has(def.id))
        .map(({ def, jsonPath }) => `components.json: ${jsonPath}: component ${def.id} has no files`)
}

export function unmappedPaths(root: TreeNode): string[] {
    const unmapped = root.children?.find((node) => node.id === UNMAPPED_ID)
    return (unmapped?.files ?? []).map((file) => file.path)
}

// Repo-relative when the CLI is installed inside the repo, so the committed CLAUDE.md and hooks work on every clone
export function cliPath(repoRoot: string): string {
    const relative = path.relative(repoRoot, cliFile)
    const isInside = relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative)
    return (isInside ? relative : cliFile).replaceAll('\\', '/')
}

export function cliCommand(repoRoot: string): string {
    const cli = cliPath(repoRoot)
    return /\s/.test(cli) ? `node "${cli}"` : `node ${cli}`
}
