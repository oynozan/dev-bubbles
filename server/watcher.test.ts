import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchRepo } from './watcher.ts'
import type { RepoWatcher } from './watcher.ts'

describe('watchRepo', () => {
    let baseDir: string
    let dir: string
    let gitIndexPath: string
    let watcher: RepoWatcher | undefined
    let calls: number

    async function startWatching(indexPath = gitIndexPath): Promise<void> {
        watcher = await watchRepo(dir, [indexPath, path.join(path.dirname(indexPath), 'logs', 'HEAD')], () => calls++)
    }

    async function expectOneCall(): Promise<void> {
        await vi.waitFor(() => expect(calls).toBe(1), { timeout: 3000 })
        await delay(400)
        expect(calls).toBe(1)
    }

    beforeEach(() => {
        baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-watch-'))
        dir = path.join(baseDir, 'repo')
        gitIndexPath = path.join(dir, '.git', 'index')
        fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
        fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true })
        fs.writeFileSync(gitIndexPath, 'index 1\n')
        fs.mkdirSync(path.join(dir, 'src'))
        calls = 0
    })

    afterEach(async () => {
        await watcher?.close()
        watcher = undefined
        fs.rmSync(baseDir, { recursive: true, force: true })
    })

    it('calls back once after a burst of changes settles', async () => {
        await startWatching()
        for (let index = 0; index < 5; index++) {
            fs.writeFileSync(path.join(dir, 'src', 'a.ts'), `line ${index}\n`)
            await delay(50)
        }
        expect(calls).toBe(0)
        await expectOneCall()
    })

    it('calls back while changes keep coming', async () => {
        await startWatching()
        for (let index = 0; index < 30 && calls === 0; index++) {
            fs.appendFileSync(path.join(dir, 'debug.log'), `line ${index}\n`)
            await delay(100)
        }
        expect(calls).toBeGreaterThan(0)
    })

    it('ignores changes inside ignored folders', async () => {
        await startWatching()
        fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n')
        fs.writeFileSync(path.join(dir, '.git', 'objects', 'blob'), 'blob\n')
        await delay(600)
        expect(calls).toBe(0)
    })

    it('ignores the config folder except the map files', async () => {
        fs.mkdirSync(path.join(dir, '.dev', 'dev-bubbles', 'server'), { recursive: true })
        await startWatching()
        fs.appendFileSync(path.join(dir, '.dev', 'server.log'), 'listening\n')
        fs.writeFileSync(path.join(dir, '.dev', 'server.json'), '{}\n')
        fs.writeFileSync(path.join(dir, '.dev', 'dev-bubbles', 'server', 'index.ts'), 'export {}\n')
        await delay(600)
        expect(calls).toBe(0)
        const tempPath = path.join(dir, '.dev', 'bugs.json.1.tmp')
        fs.writeFileSync(tempPath, '{}\n')
        fs.renameSync(tempPath, path.join(dir, '.dev', 'bugs.json'))
        await expectOneCall()
    })

    it('calls back when the git index changes', async () => {
        await startWatching()
        fs.writeFileSync(gitIndexPath, 'index 2\n')
        await expectOneCall()
    })

    it('calls back when HEAD moves, even before the reflog exists', async () => {
        await startWatching()
        fs.mkdirSync(path.join(dir, '.git', 'logs'))
        fs.writeFileSync(path.join(dir, '.git', 'logs', 'HEAD'), 'commit 1\n')
        await expectOneCall()
        calls = 0
        fs.appendFileSync(path.join(dir, '.git', 'logs', 'HEAD'), 'commit 2\n')
        await expectOneCall()
    })

    it('watches only the index and the HEAD reflog of a git dir outside the repo, as in a worktree', async () => {
        const gitDir = path.join(baseDir, 'main-git', 'worktrees', 'repo')
        fs.mkdirSync(gitDir, { recursive: true })
        fs.writeFileSync(path.join(gitDir, 'index'), 'index 1\n')
        await startWatching(path.join(gitDir, 'index'))
        fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
        await delay(600)
        expect(calls).toBe(0)
        fs.writeFileSync(path.join(gitDir, 'index'), 'index 2\n')
        await expectOneCall()
    })
})
