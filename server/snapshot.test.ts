import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import type { TreeNode } from '../shared/schema.ts'
import { buildSnapshot } from './snapshot.ts'

function flatten(node: TreeNode): TreeNode[] {
    return [node, ...(node.children ?? []).flatMap(flatten)]
}

describe('buildSnapshot', () => {
    let fixtureDir: string
    let root: TreeNode
    let nodes: TreeNode[]

    beforeAll(() => {
        fixtureDir = makeFixture()
        const packageDir = path.join(fixtureDir, 'node_modules', 'left-pad')
        fs.mkdirSync(packageDir, { recursive: true })
        fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {}\n')
        fs.mkdirSync(path.join(fixtureDir, 'empty'))
        fs.symlinkSync(path.join(fixtureDir, 'src', 'lib'), path.join(fixtureDir, 'lib-link'), 'junction')
        fs.mkdirSync(path.join(fixtureDir, 'gone'))
        fs.symlinkSync(path.join(fixtureDir, 'gone'), path.join(fixtureDir, 'gone-link'), 'junction')
        fs.rmdirSync(path.join(fixtureDir, 'gone'))
        root = buildSnapshot(fixtureDir).root
        nodes = flatten(root)
    })

    afterAll(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true })
    })

    it('roots the tree at the repo folder', () => {
        expect(root).toMatchObject({ id: 'dir:', path: '', label: path.basename(fixtureDir), size: 4096 })
    })

    it('includes directories and files with their sizes', () => {
        expect(nodes.map((node) => node.id)).toContain('dir:src')
        const session = nodes.find((node) => node.id === 'file:src/auth/session.ts')
        expect(session?.size).toBeGreaterThan(0)
    })

    it('skips excluded entries and empty directories', () => {
        const paths = nodes.map((node) => node.path)
        expect(paths.filter((nodePath) => /(^|\/)(\.git|node_modules)(\/|$)/.test(nodePath))).toEqual([])
        expect(paths).not.toContain('empty')
    })

    it('skips links to directories and links whose target is gone', () => {
        const paths = nodes.map((node) => node.path)
        expect(paths.filter((nodePath) => /^(lib|gone)-link(\/|$)/.test(nodePath))).toEqual([])
    })

    it.skipIf(process.platform === 'win32')('follows links to files', () => {
        fs.symlinkSync('session.ts', path.join(fixtureDir, 'src', 'auth', 'session-link.ts'))
        const link = flatten(buildSnapshot(fixtureDir).root).find((node) => node.id === 'file:src/auth/session-link.ts')
        expect(link?.size).toBe(fs.statSync(path.join(fixtureDir, 'src', 'auth', 'session.ts')).size)
    })

    it('reads a directory it cannot list as empty', () => {
        expect(buildSnapshot(path.join(fixtureDir, 'missing')).root.children).toEqual([])
    })

    it('uses forward-slash paths in every id', () => {
        for (const node of nodes) {
            expect(node.path).not.toContain('\\')
            expect(node.id).toBe(node.children ? `dir:${node.path}` : `file:${node.path}`)
        }
    })

    it('sorts children by name', () => {
        for (const node of nodes) {
            const labels = (node.children ?? []).map((child) => child.label)
            expect(labels).toEqual([...labels].sort())
        }
    })
})
