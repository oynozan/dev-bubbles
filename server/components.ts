import micromatch from 'micromatch'
import { dirId, fileId, ownFilesId, ROOT_ID, UNMAPPED_ID } from '../shared/schema.ts'
import type { ComponentDef, FileRef, Manifest, TreeNode } from '../shared/schema.ts'
import { compareStrings } from './inventory.ts'

export type ComponentEntry = {
    def: ComponentDef
    depth: number
    jsonPath: string
}

type CompiledComponent = ComponentEntry & {
    matches: (filePath: string) => boolean
}

type Assignment = {
    owned: Map<ComponentDef, FileRef[]>
    unmapped: FileRef[]
}

type Directory = {
    path: string
    subdirs: Map<string, Directory>
    files: FileRef[]
}

const globOptions = { dot: true }

export function buildTree(repoName: string, files: FileRef[], manifest: Manifest | undefined): TreeNode {
    const root: TreeNode = { id: ROOT_ID, kind: 'dir', label: repoName, path: '' }
    const refs = files.map(({ path, loc }) => ({ path, loc })).sort(compareByPath)
    if (!manifest?.components.length) {
        const top = groupByDirectory(refs)
        return { ...root, children: withOwnFiles(root, buildSubdirNodes(top), top.files) }
    }
    const { owned, unmapped } = assignFiles(refs, manifest.components)
    const children = manifest.components.flatMap((def) => buildComponentNode(def, owned) ?? [])
    if (unmapped.length > 0) children.push({ id: UNMAPPED_ID, kind: 'component', label: 'Unmapped', files: unmapped })
    return { ...root, children }
}

export function checkManifest(manifest: Manifest): string[] {
    const errors: string[] = []
    const ids = new Set<string>()
    for (const { def, jsonPath } of listComponents(manifest.components)) {
        if (ids.has(def.id)) errors.push(`components.json: ${jsonPath}.id: duplicate component id ${def.id}`)
        ids.add(def.id)
    }
    for (const field of ['edges', 'httpEdges'] as const) {
        manifest[field]?.forEach((edge, index) => {
            for (const end of ['from', 'to'] as const) {
                if (!ids.has(edge[end])) errors.push(`components.json: ${field}[${index}].${end}: unknown component id ${edge[end]}`)
            }
        })
    }
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

// Bug marks and edges can name a file inside a leaf as well as a bubble
export function treeIds(root: TreeNode): Set<string> {
    return new Set(flattenTree(root).flatMap((node) => [node.id, ...(node.files ?? []).map((file) => fileId(file.path))]))
}

/* Assignment */

function assignFiles(files: FileRef[], components: ComponentDef[]): Assignment {
    const compiled = listComponents(components).map(compileComponent)
    const owned = new Map<ComponentDef, FileRef[]>()
    const unmapped: FileRef[] = []
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

function buildComponentNode(def: ComponentDef, owned: Map<ComponentDef, FileRef[]>): TreeNode | undefined {
    const children = (def.children ?? []).flatMap((child) => buildComponentNode(child, owned) ?? [])
    const files = owned.get(def) ?? []
    if (children.length === 0 && files.length === 0) return undefined
    return groupOrLeaf({ id: def.id, kind: 'component', label: def.label }, children, files)
}

function groupByDirectory(files: FileRef[]): Directory {
    const root: Directory = { path: '', subdirs: new Map(), files: [] }
    for (const file of files) {
        let dir = root
        for (const name of file.path.split('/').slice(0, -1)) {
            let subdir = dir.subdirs.get(name)
            if (!subdir) {
                subdir = { path: dir.path ? `${dir.path}/${name}` : name, subdirs: new Map(), files: [] }
                dir.subdirs.set(name, subdir)
            }
            dir = subdir
        }
        dir.files.push(file)
    }
    return root
}

function buildSubdirNodes(dir: Directory): TreeNode[] {
    return [...dir.subdirs]
        .sort(([nameA], [nameB]) => compareStrings(nameA, nameB))
        .map(([name, subdir]) => groupOrLeaf(
            { id: dirId(subdir.path), kind: 'dir', label: name, path: subdir.path },
            buildSubdirNodes(subdir),
            subdir.files,
        ))
}

function groupOrLeaf(node: TreeNode, children: TreeNode[], files: FileRef[]): TreeNode {
    return children.length > 0 ? { ...node, children: withOwnFiles(node, children, files) } : { ...node, files }
}

// A bubble never holds both, so a group's own files go to an extra leaf that shares its label
function withOwnFiles(group: TreeNode, children: TreeNode[], files: FileRef[]): TreeNode[] {
    return files.length > 0 ? [...children, { ...group, id: ownFilesId(group.id), files }] : children
}

function compareByPath(a: FileRef, b: FileRef): number {
    return compareStrings(a.path, b.path)
}
