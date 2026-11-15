import { describe, expect, it } from 'vitest'
import type { ComponentDef, Manifest, TreeNode } from '../shared/schema.ts'
import { buildTree, checkManifest, flattenTree } from './components.ts'
import type { InventoryFile } from './inventory.ts'

function files(...paths: string[]): InventoryFile[] {
    return paths.map((path) => ({ path, loc: 10, mtimeMs: 0, size: 100 }))
}

function manifest(components: ComponentDef[], extra: Partial<Manifest> = {}): Manifest {
    return { version: 1, components, ...extra }
}

function ownerOf(root: TreeNode, filePath: string): string | undefined {
    const parent = flattenTree(root).find((node) => node.children?.some((child) => child.id === `file:${filePath}`))
    return parent?.id
}

function childIds(node: TreeNode | undefined): string[] {
    return node?.children?.map((child) => child.id) ?? []
}

describe('buildTree without components', () => {
    it('returns the directory tree with directories first and names sorted', () => {
        const root = buildTree('repo', files('src/b.ts', 'README.md', 'src/a.ts', 'src/lib/x.ts', 'a.txt'), undefined)
        expect(root).toMatchObject({ id: 'dir:', kind: 'dir', label: 'repo', path: '' })
        expect(childIds(root)).toEqual(['dir:src', 'file:README.md', 'file:a.txt'])
        const src = root.children?.[0]
        expect(src).toMatchObject({ kind: 'dir', label: 'src', path: 'src' })
        expect(childIds(src)).toEqual(['dir:src/lib', 'file:src/a.ts', 'file:src/b.ts'])
        expect(src?.children?.[0].children?.[0]).toEqual({
            id: 'file:src/lib/x.ts', kind: 'file', label: 'x.ts', path: 'src/lib/x.ts', loc: 10,
        })
    })

    it('treats a manifest with zero components like no manifest', () => {
        const input = files('src/a.ts')
        expect(buildTree('repo', input, manifest([]))).toEqual(buildTree('repo', input, undefined))
    })
})

describe('buildTree assignment', () => {
    it('gives a file to the deepest matching component', () => {
        const root = buildTree('repo', files('src/auth/session.ts', 'src/auth/oauth/google/client.ts'), manifest([
            {
                id: 'auth', label: 'Auth', include: ['src/auth/**'], children: [
                    { id: 'auth.google', label: 'Google', include: ['src/auth/oauth/google/**'] },
                ],
            },
        ]))
        expect(ownerOf(root, 'src/auth/session.ts')).toBe('auth')
        expect(ownerOf(root, 'src/auth/oauth/google/client.ts')).toBe('auth.google')
        expect(childIds(root.children?.[0])).toEqual(['auth.google', 'file:src/auth/session.ts'])
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
    it('puts files that match no component under Unmapped as a directory tree', () => {
        const root = buildTree('repo', files('src/lib/url.ts', 'web/src/App.tsx', 'web/main.tsx', 'README.md'), manifest([
            { id: 'lib', label: 'lib', include: ['src/lib/**'] },
        ]))
        expect(childIds(root)).toEqual(['lib', 'unmapped'])
        const unmapped = root.children?.[1]
        expect(unmapped).toMatchObject({ id: 'unmapped', kind: 'component', label: 'Unmapped' })
        expect(childIds(unmapped)).toEqual(['dir:web', 'file:README.md'])
        expect(childIds(unmapped?.children?.[0])).toEqual(['dir:web/src', 'file:web/main.tsx'])
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
        expect(childIds(root.children?.[0])).toEqual(['file:src/auth/session.ts'])
    })

    it('keeps a parent whose files all belong to its children', () => {
        const root = buildTree('repo', files('src/auth/oauth/google/client.ts'), manifest([
            {
                id: 'auth', label: 'Auth', include: ['src/auth/**'], children: [
                    { id: 'auth.google', label: 'Google', include: ['src/auth/oauth/google/**'] },
                ],
            },
        ]))
        expect(childIds(root)).toEqual(['auth'])
        expect(childIds(root.children?.[0])).toEqual(['auth.google'])
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
