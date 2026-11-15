import { describe, expect, it } from 'vitest'
import type { ComponentDef, Manifest, TreeNode } from '../shared/schema.ts'
import { buildTree, checkManifest, flattenTree, treeIds } from './components.ts'
import type { InventoryFile } from './inventory.ts'

function files(...paths: string[]): InventoryFile[] {
    return paths.map((path) => ({ path, loc: 10, mtimeMs: 0, size: 100 }))
}

function manifest(components: ComponentDef[], extra: Partial<Manifest> = {}): Manifest {
    return { version: 1, components, ...extra }
}

function ownerOf(root: TreeNode, filePath: string): string | undefined {
    return flattenTree(root).find((node) => node.files?.some((file) => file.path === filePath))?.id
}

function childIds(node: TreeNode | undefined): string[] {
    return node?.children?.map((child) => child.id) ?? []
}

function filePaths(node: TreeNode | undefined): string[] {
    return node?.files?.map((file) => file.path) ?? []
}

const authWithGoogle: ComponentDef = {
    id: 'auth', label: 'Auth', include: ['src/auth/**'], children: [
        { id: 'auth.google', label: 'Google', include: ['src/auth/oauth/google/**'] },
    ],
}

describe('buildTree without components', () => {
    it('groups files into directories sorted by name with the own files of a directory in a last leaf', () => {
        const root = buildTree('repo', files('src/b.ts', 'README.md', 'src/a.ts', 'src/lib/x.ts', 'a.txt'), undefined)
        expect(root).toMatchObject({ id: 'dir:', kind: 'dir', label: 'repo', path: '' })
        expect(childIds(root)).toEqual(['dir:src', 'own:dir:'])
        expect(root.children?.[1]).toEqual({
            id: 'own:dir:',
            kind: 'dir',
            label: 'repo',
            path: '',
            files: [{ path: 'README.md', loc: 10 }, { path: 'a.txt', loc: 10 }],
        })
        const src = root.children?.[0]
        expect(src).toMatchObject({ kind: 'dir', label: 'src', path: 'src' })
        expect(src?.files).toBeUndefined()
        expect(childIds(src)).toEqual(['dir:src/lib', 'own:dir:src'])
        expect(src?.children?.[0]).toEqual({
            id: 'dir:src/lib', kind: 'dir', label: 'lib', path: 'src/lib', files: [{ path: 'src/lib/x.ts', loc: 10 }],
        })
        expect(src?.children?.[1]).toMatchObject({ kind: 'dir', label: 'src', path: 'src' })
        expect(filePaths(src?.children?.[1])).toEqual(['src/a.ts', 'src/b.ts'])
    })

    it('keeps the root a group when every file sits at the top', () => {
        const root = buildTree('repo', files('b.ts', 'a.ts'), undefined)
        expect(childIds(root)).toEqual(['own:dir:'])
        expect(filePaths(root.children?.[0])).toEqual(['a.ts', 'b.ts'])
    })

    it('returns an empty root for an empty repo', () => {
        expect(buildTree('repo', [], undefined)).toEqual({ id: 'dir:', kind: 'dir', label: 'repo', path: '', children: [] })
    })

    it('treats a manifest with zero components like no manifest', () => {
        const input = files('src/a.ts')
        expect(buildTree('repo', input, manifest([]))).toEqual(buildTree('repo', input, undefined))
    })
})

describe('buildTree assignment', () => {
    it('gives a file to the deepest matching component', () => {
        const root = buildTree('repo', files('src/auth/session.ts', 'src/auth/oauth/google/client.ts'), manifest([authWithGoogle]))
        expect(ownerOf(root, 'src/auth/session.ts')).toBe('own:auth')
        expect(ownerOf(root, 'src/auth/oauth/google/client.ts')).toBe('auth.google')
    })

    it('breaks a tie at the same depth by document order', () => {
        const root = buildTree('repo', files('src/lib/url.ts'), manifest([
            { id: 'first', label: 'First', include: ['src/**'] },
            { id: 'second', label: 'Second', include: ['src/lib/**'] },
        ]))
        expect(ownerOf(root, 'src/lib/url.ts')).toBe('first')
    })

    it('skips components whose exclude matches the file', () => {
        const root = buildTree('repo', files('src/lib/url.ts', 'src/lib/url.test.ts'), manifest([
            { id: 'lib', label: 'lib', include: ['src/lib/**'], exclude: ['**/*.test.ts'] },
            { id: 'tests', label: 'Tests', include: ['**/*.test.ts'] },
        ]))
        expect(ownerOf(root, 'src/lib/url.ts')).toBe('lib')
        expect(ownerOf(root, 'src/lib/url.test.ts')).toBe('tests')
    })

    it('matches dot files', () => {
        const root = buildTree('repo', files('.github/workflows/ci.yml'), manifest([
            { id: 'ci', label: 'CI', include: ['.github/**'] },
        ]))
        expect(ownerOf(root, '.github/workflows/ci.yml')).toBe('ci')
    })

    it('keeps every file it is given, since ignore globs are applied by the inventory', () => {
        const root = buildTree('repo', files('package-lock.json'), manifest(
            [{ id: 'app', label: 'App', include: ['**'] }],
            { ignore: ['**/package-lock.json'] },
        ))
        expect(ownerOf(root, 'package-lock.json')).toBe('app')
    })
})

describe('buildTree grouping', () => {
    it('makes a component without sub-components a leaf with its files sorted by path', () => {
        const root = buildTree('repo', files('src/lib/url.ts', 'src/lib/a/b.ts', 'src/lib/http.ts'), manifest([
            { id: 'lib', label: 'Helpers', include: ['src/lib/**'] },
        ]))
        expect(root.children).toEqual([{
            id: 'lib',
            kind: 'component',
            label: 'Helpers',
            files: [{ path: 'src/lib/a/b.ts', loc: 10 }, { path: 'src/lib/http.ts', loc: 10 }, { path: 'src/lib/url.ts', loc: 10 }],
        }])
    })

    it('puts the own files of a component with sub-components in a last leaf named after it', () => {
        const root = buildTree('repo', files('src/auth/session.ts', 'src/auth/oauth/google/client.ts'), manifest([authWithGoogle]))
        const auth = root.children?.[0]
        expect(auth?.files).toBeUndefined()
        expect(childIds(auth)).toEqual(['auth.google', 'own:auth'])
        expect(auth?.children?.[1]).toEqual({
            id: 'own:auth', kind: 'component', label: 'Auth', files: [{ path: 'src/auth/session.ts', loc: 10 }],
        })
    })

    it('puts files that match no component in one Unmapped leaf', () => {
        const root = buildTree('repo', files('src/lib/url.ts', 'web/src/App.tsx', 'web/main.tsx', 'README.md'), manifest([
            { id: 'lib', label: 'lib', include: ['src/lib/**'] },
        ]))
        expect(childIds(root)).toEqual(['lib', 'unmapped'])
        expect(root.children?.[1]).toEqual({
            id: 'unmapped',
            kind: 'component',
            label: 'Unmapped',
            files: [{ path: 'README.md', loc: 10 }, { path: 'web/main.tsx', loc: 10 }, { path: 'web/src/App.tsx', loc: 10 }],
        })
    })

    it('leaves out Unmapped when every file is mapped', () => {
        const root = buildTree('repo', files('src/a.ts'), manifest([{ id: 'src', label: 'src', include: ['src/**'] }]))
        expect(childIds(root)).toEqual(['src'])
    })

    it('drops components with no files in their subtree', () => {
        const root = buildTree('repo', files('src/auth/session.ts'), manifest([
            {
                id: 'auth', label: 'Auth', include: ['src/auth/**'], children: [
                    { id: 'auth.apple', label: 'Apple', include: ['src/auth/oauth/apple/**'] },
                ],
            },
            { id: 'billing', label: 'Billing', include: ['src/billing/**'] },
        ]))
        expect(childIds(root)).toEqual(['auth'])
        expect(root.children?.[0].children).toBeUndefined()
        expect(filePaths(root.children?.[0])).toEqual(['src/auth/session.ts'])
    })

    it('keeps a parent whose files all belong to its children', () => {
        const root = buildTree('repo', files('src/auth/oauth/google/client.ts'), manifest([authWithGoogle]))
        expect(childIds(root)).toEqual(['auth'])
        expect(childIds(root.children?.[0])).toEqual(['auth.google'])
        expect(root.children?.[0].files).toBeUndefined()
    })
})

describe('treeIds', () => {
    it('lists every bubble id and the file id of every file reference', () => {
        const input = files('src/auth/session.ts', 'src/auth/oauth/google/client.ts', 'README.md')
        const ids = treeIds(buildTree('repo', input, manifest([authWithGoogle])))
        expect([...ids].sort()).toEqual([
            'auth',
            'auth.google',
            'dir:',
            'file:README.md',
            'file:src/auth/oauth/google/client.ts',
            'file:src/auth/session.ts',
            'own:auth',
            'unmapped',
        ])
    })
})

describe('checkManifest', () => {
    it('accepts unique ids and known http edge ends', () => {
        const valid = manifest(
            [{ id: 'web', label: 'Web', include: ['web/**'] }, { id: 'api', label: 'API', include: ['src/api/**'] }],
            { httpEdges: [{ from: 'web', to: 'api' }] },
        )
        expect(checkManifest(valid)).toEqual([])
    })

    it('reports duplicate ids with their JSON path', () => {
        const errors = checkManifest(manifest([
            { id: 'auth', label: 'Auth', include: [], children: [{ id: 'auth', label: 'Again', include: [] }] },
        ]))
        expect(errors).toEqual(['components.json: components[0].children[0].id: duplicate component id auth'])
    })

    it('reports http edges that point at unknown components', () => {
        const errors = checkManifest(manifest(
            [{ id: 'web', label: 'Web', include: [] }],
            { httpEdges: [{ from: 'web', to: 'api.billing' }] },
        ))
        expect(errors).toEqual(['components.json: httpEdges[0].to: unknown component id api.billing'])
    })
})
