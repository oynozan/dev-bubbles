import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import { createInventory, findRepoRoot } from './inventory.ts'
import type { InventoryFile } from './inventory.ts'

function writeFile(root: string, filePath: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(path.join(root, filePath)), { recursive: true })
    fs.writeFileSync(path.join(root, filePath), content)
}

function locByPath(files: InventoryFile[]): Map<string, number> {
    return new Map(files.map((file) => [file.path, file.loc]))
}

describe('inventory', () => {
    let fixtureDir: string
    let files: InventoryFile[]

    beforeAll(async () => {
        fixtureDir = makeFixture()
        writeFile(fixtureDir, 'src/draft.ts', 'one\ntwo\nthree')
        writeFile(fixtureDir, 'src/empty.ts', '')
        writeFile(fixtureDir, 'debug.log', 'ignored by git\n')
        writeFile(fixtureDir, 'assets/logo.bin', Buffer.from([1, 2, 0, 3, 10]))
        writeFile(fixtureDir, 'assets/huge.txt', 'x\n'.repeat(600 * 1024))
        writeFile(fixtureDir, '.dev-bubbles/components.json', '{}\n')
        files = await createInventory(fixtureDir, { trackedOnly: false }).scan([])
    })

    afterAll(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true })
    })

    it('lists tracked and untracked files with forward-slash paths in sorted order', () => {
        const paths = files.map((file) => file.path)
        expect(paths).toEqual(expect.arrayContaining(['src/auth/session.ts', 'web/src/LoginPage.tsx', 'src/draft.ts']))
        expect(paths).toEqual([...paths].sort())
        expect(paths.filter((filePath) => filePath.includes('\\'))).toEqual([])
    })

    it('leaves out gitignored files, binaries, large files and the config folder', () => {
        const paths = files.map((file) => file.path)
        expect(paths).not.toContain('debug.log')
        expect(paths).not.toContain('assets/logo.bin')
        expect(paths).not.toContain('assets/huge.txt')
        expect(paths.filter((filePath) => filePath.startsWith('.dev-bubbles/'))).toEqual([])
    })

    it('counts lines including a final line without a newline', () => {
        const loc = locByPath(files)
        expect(loc.get('src/draft.ts')).toBe(3)
        expect(loc.get('src/empty.ts')).toBe(0)
        const session = fs.readFileSync(path.join(fixtureDir, 'src/auth/session.ts'), 'utf8')
        expect(loc.get('src/auth/session.ts')).toBe(session.split('\n').length - 1)
    })

    it('hides untracked files in tracked-only mode', async () => {
        const paths = (await createInventory(fixtureDir, { trackedOnly: true }).scan([])).map((file) => file.path)
        expect(paths).toContain('src/auth/session.ts')
        expect(paths).not.toContain('src/draft.ts')
    })

    it('drops files matching the ignore globs', async () => {
        const paths = (await createInventory(fixtureDir, { trackedOnly: false }).scan(['**/*.tsx', '.gitignore']))
            .map((file) => file.path)
        expect(paths).toContain('src/auth/session.ts')
        expect(paths.filter((filePath) => filePath.endsWith('.tsx') || filePath === '.gitignore')).toEqual([])
    })

    it('picks up edited, added and deleted files on the next scan', async () => {
        const inventory = createInventory(fixtureDir, { trackedOnly: false })
        await inventory.scan([])
        writeFile(fixtureDir, 'src/draft.ts', 'one\ntwo\nthree\nfour\nfive\n')
        writeFile(fixtureDir, 'src/added.ts', 'export {}\n')
        fs.rmSync(path.join(fixtureDir, 'src/lib/logger.ts'))
        const loc = locByPath(await inventory.scan([]))
        expect(loc.get('src/draft.ts')).toBe(5)
        expect(loc.get('src/added.ts')).toBe(1)
        expect(loc.has('src/lib/logger.ts')).toBe(false)
    })
})

describe('findRepoRoot', () => {
    it('finds the root from a subdirectory', async () => {
        const fixtureDir = makeFixture()
        try {
            const root = await findRepoRoot(path.join(fixtureDir, 'src', 'auth'))
            expect(fs.realpathSync.native(root)).toBe(fs.realpathSync.native(fixtureDir))
        } finally {
            fs.rmSync(fixtureDir, { recursive: true, force: true })
        }
    })

    it('rejects a folder outside any git repository', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-plain-'))
        vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(dir))
        try {
            await expect(findRepoRoot(dir)).rejects.toThrow(/not inside a git repository/i)
        } finally {
            vi.unstubAllEnvs()
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
