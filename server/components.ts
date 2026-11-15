import micromatch from 'micromatch'
import { dirId, fileId, ROOT_ID, UNMAPPED_ID } from '../shared/schema.ts'
import type { ComponentDef, Manifest, TreeNode } from '../shared/schema.ts'
import { compareStrings } from './inventory.ts'
import type { InventoryFile } from './inventory.ts'

export type ComponentEntry = {
    def: ComponentDef
    depth: number
    jsonPath: string
}

type CompiledComponent = ComponentEntry & {
    matches: (filePath: string) => boolean
}

type Assignment = {
    owned: Map<ComponentDef, InventoryFile[]>
    unmapped: InventoryFile[]
}

const globOptions = { dot: true }

export function buildTree(repoName: string, files: InventoryFile[], manifest: Manifest | undefined): TreeNode {
    const root: TreeNode = { id: ROOT_ID, kind: 'dir', label: repoName, path: '' }
    if (!manifest?.components.length) return { ...root, children: buildDirectoryChildren(files) }
    const { owned, unmapped } = assignFiles(files, manifest.components)
    const children = manifest.components.flatMap((def) => buildComponentNode(def, owned) ?? [])
    if (unmapped.length > 0) {
        children.push({ id: UNMAPPED_ID, kind: 'component', label: 'Unmapped', children: buildDirectoryChildren(unmapped) })
    }
    return { ...root, children }
}

export function checkManifest(manifest: Manifest): string[] {
    const errors: string[] = []
    const ids = new Set<string>()
    for (const { def, jsonPath } of listComponents(manifest.components)) {
        if (ids.has(def.id)) errors.push(`components.json: ${jsonPath}.id: duplicate component id ${def.id}`)
        ids.add(def.id)
    }
    manifest.httpEdges?.forEach((edge, index) => {
        for (const end of ['from', 'to'] as const) {
            if (!ids.has(edge[end])) errors.push(`components.json: httpEdges[${index}].${end}: unknown component id ${edge[end]}`)
        }
    })
    return errors
}

export function listComponents(defs: ComponentDef[], parentPath = 'components', depth = 0): ComponentEntry[] {
    return defs.flatMap((def, index) => {
        const jsonPath = `${parentPath}[${index}]`
        return [{ def, depth, jsonPath }, ...listComponents(def.children ?? [], `${jsonPath}.children`, depth + 1)]
    })
}

export function flattenTree(node: TreeNode): TreeNode[] {
    return [node, ...(node.children ?? []).flatMap(flattenTree)]
}

/* Assignment */

function assignFiles(files: InventoryFile[], components: ComponentDef[]): Assignment {
    const compiled = listComponents(components).map(compileComponent)
    const owned = new Map<ComponentDef, InventoryFile[]>()
    const unmapped: InventoryFile[] = []
    for (const file of files) {
        const owner = findOwner(file.path, compiled)
        if (!owner) {
            unmapped.push(file)
            continue
        }
        const ownerFiles = owned.get(owner) ?? []
        ownerFiles.push(file)
        owned.set(owner, ownerFiles)
    }
    return { owned, unmapped }
}

function compileComponent(entry: ComponentEntry): CompiledComponent {
    const included = entry.def.include.map((glob) => micromatch.matcher(glob, globOptions))
    const excluded = (entry.def.exclude ?? []).map((glob) => micromatch.matcher(glob, globOptions))
    const matches = (filePath: string) => included.some((isMatch) => isMatch(filePath))
        && !excluded.some((isMatch) => isMatch(filePath))
    return { ...entry, matches }
}

function findOwner(filePath: string, components: CompiledComponent[]): ComponentDef | undefined {
    let owner: CompiledComponent | undefined
    for (const component of components) {
        if ((!owner || component.depth > owner.depth) && component.matches(filePath)) owner = component
    }
    return owner?.def
}

/* Tree nodes */

function buildComponentNode(def: ComponentDef, owned: Map<ComponentDef, InventoryFile[]>): TreeNode | undefined {
    const childComponents = (def.children ?? []).flatMap((child) => buildComponentNode(child, owned) ?? [])
    const ownFiles = (owned.get(def) ?? []).toSorted(compareByPath).map(buildFileNode)
    const children = [...childComponents, ...ownFiles]
    if (children.length === 0) return undefined
    return { id: def.id, kind: 'component', label: def.label, children }
}

function buildDirectoryChildren(files: InventoryFile[]): TreeNode[] {
    const childrenByDir = new Map<string, TreeNode[]>([['', []]])
    for (const file of files) {
        directoryChildren(parentPath(file.path), childrenByDir).push(buildFileNode(file))
    }
    for (const children of childrenByDir.values()) children.sort(compareNodes)
    return childrenByDir.get('') ?? []
}

function directoryChildren(dirPath: string, childrenByDir: Map<string, TreeNode[]>): TreeNode[] {
    const existing = childrenByDir.get(dirPath)
    if (existing) return existing
    const children: TreeNode[] = []
    childrenByDir.set(dirPath, children)
    const dirNode: TreeNode = { id: dirId(dirPath), kind: 'dir', label: baseName(dirPath), path: dirPath, children }
    directoryChildren(parentPath(dirPath), childrenByDir).push(dirNode)
    return children
}

function buildFileNode(file: InventoryFile): TreeNode {
    return { id: fileId(file.path), kind: 'file', label: baseName(file.path), path: file.path, loc: file.loc }
}

function parentPath(filePath: string): string {
    const slash = filePath.lastIndexOf('/')
    return slash < 0 ? '' : filePath.slice(0, slash)
}

function baseName(filePath: string): string {
    return filePath.slice(filePath.lastIndexOf('/') + 1)
}

function compareNodes(a: TreeNode, b: TreeNode): number {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return compareStrings(a.label, b.label)
}

function compareByPath(a: InventoryFile, b: InventoryFile): number {
    return compareStrings(a.path, b.path)
}
