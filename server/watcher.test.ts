import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchRepo } from './watcher.ts'
import type { RepoWatcher } from './watcher.ts'

describe('watchRepo', () => {
    let dir: string
    let watcher: RepoWatcher | undefined
    let calls: number

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-watch-'))
        fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
        fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true })
        fs.writeFileSync(path.join(dir, '.git', 'index'), 'index 1\n')
        fs.mkdirSync(path.join(dir, 'src'))
        calls = 0
    })

    afterEach(async () => {
        await watcher?.close()
        fs.rmSync(dir, { recursive: true, force: true })
    })

    it('calls back once after a burst of changes settles', async () => {
        watcher = await watchRepo(dir, () => calls++)
        for (let index = 0; index < 5; index++) {
            fs.writeFileSync(path.join(dir, 'src', 'a.ts'), `line ${index}\n`)
            await delay(100)
        }
        expect(calls).toBe(0)
        await delay(600)
        expect(calls).toBe(1)
    })

    it('ignores changes inside ignored folders', async () => {
        watcher = await watchRepo(dir, () => calls++)
        fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n')
        fs.writeFileSync(path.join(dir, '.git', 'objects', 'blob'), 'blob\n')
        await delay(600)
        expect(calls).toBe(0)
    })

    it('calls back when the git index changes', async () => {
        watcher = await watchRepo(dir, () => calls++)
        fs.writeFileSync(path.join(dir, '.git', 'index'), 'index 2\n')
        await delay(600)
        expect(calls).toBe(1)
    })
})
