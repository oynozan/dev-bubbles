import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import { ROOT_ID } from '../shared/schema.ts'
import type { FileRef, Manifest, TreeNode } from '../shared/schema.ts'
import { flattenTree } from './components.ts'
import { createSnapshotSource } from './snapshot.ts'
import type { SnapshotSource } from './snapshot.ts'

const manifest: Manifest = {
    version: 1,
    components: [{ id: 'auth', label: 'Auth', include: ['src/auth/**'] }],
}

function nodeIds(root: TreeNode): string[] {
    return flattenTree(root).map((node) => node.id)
}

function allFiles(root: TreeNode): FileRef[] {
    return flattenTree(root).flatMap((node) => node.files ?? [])
}

describe('createSnapshotSource', () => {
    let fixtureDir: string
    let source: SnapshotSource

    function writeConfig(fileName: string, content: unknown): void {
        fs.mkdirSync(path.join(fixtureDir, '.dev-bubbles'), { recursive: true })
        const text = typeof content === 'string' ? content : JSON.stringify(content)
        fs.writeFileSync(path.join(fixtureDir, '.dev-bubbles', fileName), text)
    }

    beforeEach(() => {
        fixtureDir = makeFixture()
        source = createSnapshotSource(fixtureDir, { trackedOnly: false })
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 10 })
    })

    it('builds the directory tree with line counts when there is no config', async () => {
        const snapshot = await source.rescan()
        expect(snapshot.root).toMatchObject({ id: ROOT_ID, kind: 'dir', label: path.basename(fixtureDir) })
        const auth = flattenTree(snapshot.root).find((node) => node.id === 'own:dir:src/auth')
        expect(auth).toMatchObject({ kind: 'dir', label: 'auth', path: 'src/auth' })
        expect(auth?.files?.map((file) => file.path)).toEqual(['src/auth/session.ts'])
        expect(allFiles(snapshot.root).find((file) => file.path === 'src/auth/session.ts')?.loc).toBeGreaterThan(0)
        expect(snapshot).toMatchObject({ bugs: [], pins: {}, errors: [] })
        expect(Date.parse(snapshot.generatedAt)).not.toBeNaN()
        expect(snapshot.commits).toEqual([expect.objectContaining({ subject: 'Initial commit', author: 'dev-bubbles' })])
        expect(snapshot).not.toHaveProperty('commit')
    })

    it('includes import and http edges', async () => {
        const { edges } = await source.rescan()
        expect(edges).toContainEqual(expect.objectContaining({ kind: 'import' }))
        expect(edges).toContainEqual({
            from: 'file:web/src/LoginPage.tsx',
            to: 'file:src/api/routes/login.ts',
            kind: 'http',
            label: 'POST /api/login',
        })
    })

    it('keeps file-level edges between files that sit inside component leaves', async () => {
        writeConfig('components.json', manifest)
        const { root, edges } = await source.rescan()
        expect(nodeIds(root)).not.toContain('file:src/auth/session.ts')
        expect(edges).toContainEqual(expect.objectContaining({ from: 'file:src/auth/session.ts', kind: 'import' }))
        expect(edges).toContainEqual(expect.objectContaining({ from: 'file:web/src/LoginPage.tsx', kind: 'http' }))
    })

    it('keeps the last valid manifest when components.json breaks', async () => {
        writeConfig('components.json', manifest)
        expect(nodeIds((await source.rescan()).root)).toContain('auth')
        writeConfig('components.json', '{ "version": 1, ')
        const broken = await source.rescan()
        expect(nodeIds(broken.root)).toContain('auth')
        expect(broken.errors).toEqual([expect.stringMatching(/^components\.json: /)])
        fs.rmSync(path.join(fixtureDir, '.dev-bubbles', 'components.json'))
        const missing = await source.rescan()
        expect(nodeIds(missing.root)).not.toContain('auth')
        expect(missing.errors).toEqual([])
    })

    it('applies the manifest ignore globs', async () => {
        writeConfig('components.json', { ...manifest, ignore: ['web/**'] })
        const paths = allFiles((await source.rescan()).root).map((file) => file.path)
        expect(paths).toContain('src/auth/session.ts')
        expect(paths.filter((filePath) => filePath.startsWith('web/'))).toEqual([])
    })

    it('keeps the last valid manifest when components.json has semantic errors', async () => {
        writeConfig('components.json', manifest)
        await source.rescan()
        const duplicate = { id: 'auth', label: 'Login', include: ['src/lib/**'] }
        writeConfig('components.json', { ...manifest, components: [...manifest.components, duplicate] })
        const broken = await source.rescan()
        expect(flattenTree(broken.root).filter((node) => node.id === 'auth')).toEqual([
            expect.objectContaining({ label: 'Auth' }),
        ])
        expect(broken.errors).toEqual([expect.stringContaining('duplicate component id auth')])
        writeConfig('components.json', { ...manifest, httpEdges: [{ from: 'auth', to: 'nowhere' }] })
        expect((await source.rescan()).errors).toEqual([expect.stringContaining('nowhere')])
    })

    it('keeps manual http edges only between components on the map', async () => {
        writeConfig('components.json', {
            version: 1,
            components: [
                ...manifest.components,
                { id: 'lib', label: 'lib', include: ['src/lib/**'] },
                { id: 'empty', label: 'Empty', include: ['nothing/**'] },
            ],
            httpEdges: [{ from: 'auth', to: 'lib', note: 'redirect helper' }, { from: 'auth', to: 'empty' }],
        })
        const { edges } = await source.rescan()
        expect(edges).toContainEqual({ from: 'auth', to: 'lib', kind: 'http', label: 'redirect helper' })
        expect(edges.filter((edge) => edge.to === 'empty')).toEqual([])
    })

    it('resolves open bug marks and reports unknown targets', async () => {
        writeConfig('components.json', manifest)
        writeConfig('bugs.json', {
            version: 1,
            bugs: [
                { id: 'b1', title: 'Login loops', status: 'open', marks: [
                    { component: 'auth', state: 'suspected' },
                    { component: 'auth.missing', state: 'confirmed' },
                ] },
                { id: 'b2', title: 'Old bug', status: 'fixed', marks: [{ component: 'auth', state: 'confirmed' }] },
            ],
        })
        const snapshot = await source.rescan()
        expect(snapshot.bugs).toEqual([{ id: 'b1', title: 'Login loops', marks: [{ nodeId: 'auth', state: 'suspected' }] }])
        expect(snapshot.errors).toEqual([expect.stringContaining('auth.missing')])
    })

    it('resolves a bug mark on a file inside a leaf', async () => {
        writeConfig('components.json', manifest)
        writeConfig('bugs.json', {
            version: 1,
            bugs: [{ id: 'b1', title: 'Session lost', status: 'open', marks: [
                { file: 'src/auth/session.ts', state: 'confirmed', reason: 'drops the cookie' },
            ] }],
        })
        const snapshot = await source.rescan()
        expect(snapshot.bugs[0].marks).toEqual([{ nodeId: 'file:src/auth/session.ts', state: 'confirmed', reason: 'drops the cookie' }])
        expect(snapshot.errors).toEqual([])
    })

    it('carries pins from layout.json and keeps them when the file breaks', async () => {
        writeConfig('layout.json', { version: 1, pins: { 'dir:src': [10, -5] } })
        expect((await source.rescan()).pins).toEqual({ 'dir:src': [10, -5] })
        writeConfig('layout.json', { version: 1, pins: { 'dir:src': 'left' } })
        const broken = await source.rescan()
        expect(broken.pins).toEqual({ 'dir:src': [10, -5] })
        expect(broken.errors).toEqual([expect.stringMatching(/^layout\.json: pins\["dir:src"\]: /)])
    })

    it('sets and clears pins in layout.json', async () => {
        const layoutPath = path.join(fixtureDir, '.dev-bubbles', 'layout.json')
        source.setPin({ id: 'dir:src', pin: [1.5, 2] })
        source.setPin({ id: 'file:src/lib/url.ts', pin: [-3, 4] })
        source.setPin({ id: 'dir:src', pin: null })
        expect(JSON.parse(fs.readFileSync(layoutPath, 'utf8'))).toEqual({ version: 1, pins: { 'file:src/lib/url.ts': [-3, 4] } })
        expect(fs.readdirSync(path.dirname(layoutPath))).toEqual(['layout.json'])
        expect((await source.rescan()).pins).toEqual({ 'file:src/lib/url.ts': [-3, 4] })
    })

    it('runs at most one follow-up scan for calls made during a scan', async () => {
        const first = source.rescan()
        const second = source.rescan()
        const third = source.rescan()
        expect(second).toBe(third)
        expect(await first).not.toBe(await second)
    })

    it('keeps the last snapshot and reports the error when a scan fails', async () => {
        const before = await source.rescan()
        vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(fixtureDir))
        fs.renameSync(path.join(fixtureDir, '.git'), path.join(fixtureDir, '.git-away'))
        const failed = await source.rescan()
        expect(failed.root).toEqual(before.root)
        expect(failed.errors).toEqual([expect.stringMatching(/^Rescan failed: /)])
        fs.renameSync(path.join(fixtureDir, '.git-away'), path.join(fixtureDir, '.git'))
        expect((await source.rescan()).errors).toEqual([])
    })
})
