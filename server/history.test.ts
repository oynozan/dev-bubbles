import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import { listCommits, resolveCommit, withCommitTree } from './history.ts'

const tempDirs: string[] = []

function git(cwd: string, ...args: string[]): string {
    const identity = ['-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@localhost', '-c', 'commit.gpgsign=false']
    return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' }).trim()
}

function makeRepo(): string {
    const repo = makeFixture()
    tempDirs.push(repo)
    return repo
}

afterAll(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('listCommits', () => {
    it('lists the commits on HEAD newest first', async () => {
        const repo = makeRepo()
        const subject = 'Fix "quotes" | pipes; tabs\tand ünïcode'
        git(repo, 'commit', '--allow-empty', '-m', subject, '-m', 'A body that stays out of the list')
        const commits = await listCommits(repo)
        expect(commits.map((commit) => commit.subject)).toEqual([subject, 'Initial commit'])
        expect(commits[0]).toMatchObject({ sha: git(repo, 'rev-parse', 'HEAD'), author: 'Ada Lovelace' })
        expect(commits[1]).toMatchObject({ sha: git(repo, 'rev-parse', 'HEAD~1'), author: 'dev-bubbles' })
        expect(commits[0].date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/)
    })

    it('lists nothing for a repo without commits', async () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-empty-'))
        tempDirs.push(repo)
        git(repo, 'init')
        expect(await listCommits(repo)).toEqual([])
    })
})

describe('resolveCommit', () => {
    it('resolves a short sha to the full one and nothing else', async () => {
        const repo = makeRepo()
        const head = git(repo, 'rev-parse', 'HEAD')
        expect(await resolveCommit(repo, head.slice(0, 7))).toBe(head)
        expect(await resolveCommit(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBeUndefined()
        expect(await resolveCommit(repo, git(repo, 'rev-parse', 'HEAD^{tree}'))).toBeUndefined()
    })
})

describe('withCommitTree', () => {
    let repo: string
    let first: string
    let tempRoot: string

    beforeAll(() => {
        repo = makeRepo()
        first = git(repo, 'rev-parse', 'HEAD')
        fs.writeFileSync(path.join(repo, 'src', 'added.ts'), 'export {}\n')
        fs.rmSync(path.join(repo, 'src', 'lib', 'logger.ts'))
        git(repo, 'add', '-A')
        git(repo, 'commit', '-m', 'Add a file and drop the logger')
    })

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-tmp-'))
        tempDirs.push(tempRoot)
        for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, tempRoot)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('checks the files of a commit out into a temp folder and removes it afterwards', async () => {
        const seen = await withCommitTree(repo, first, async (treeDir, paths) => ({
            paths,
            hasLogger: fs.statSync(path.join(treeDir, 'src', 'lib', 'logger.ts')).isFile(),
            hasAdded: fs.existsSync(path.join(treeDir, 'src', 'added.ts')),
        }))
        expect(seen.paths).toContain('src/lib/logger.ts')
        expect(seen.paths).not.toContain('src/added.ts')
        expect(seen).toMatchObject({ hasLogger: true, hasAdded: false })
        expect(fs.readdirSync(tempRoot)).toEqual([])
    })

    it('removes the temp folder when the work fails', async () => {
        await expect(withCommitTree(repo, first, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
        expect(fs.readdirSync(tempRoot)).toEqual([])
    })

    it('keeps LFS pointers instead of running a smudge filter that downloads the files', async () => {
        const lfsRepo = makeRepo()
        const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'0'.repeat(64)}\nsize 12345\n`
        const noLfs = ['-c', 'filter.lfs.process=', '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.required=false']
        fs.writeFileSync(path.join(lfsRepo, '.gitattributes'), '*.bin filter=lfs -text\n')
        fs.writeFileSync(path.join(lfsRepo, 'data.bin'), pointer)
        git(lfsRepo, ...noLfs, 'add', '-A')
        git(lfsRepo, ...noLfs, 'commit', '-m', 'Track a binary with LFS')
        // Fails like a download from a remote that cannot be reached
        for (const key of ['process', 'smudge']) git(lfsRepo, 'config', `filter.lfs.${key}`, 'false')
        git(lfsRepo, 'config', 'filter.lfs.required', 'true')
        const sha = git(lfsRepo, 'rev-parse', 'HEAD')
        const content = await withCommitTree(lfsRepo, sha, async (treeDir) => fs.readFileSync(path.join(treeDir, 'data.bin'), 'utf8'))
        expect(content).toBe(pointer)
    })

    it('links the live node_modules into the tree and leaves it in place afterwards', async () => {
        const modulePath = path.join(repo, 'node_modules', 'pkg', 'index.js')
        fs.mkdirSync(path.dirname(modulePath), { recursive: true })
        fs.writeFileSync(modulePath, 'module.exports = {}\n')
        const isLinked = await withCommitTree(repo, first, async (treeDir) => (
            fs.existsSync(path.join(treeDir, 'node_modules', 'pkg', 'index.js'))
        ))
        expect(isLinked).toBe(true)
        expect(fs.readdirSync(tempRoot)).toEqual([])
        expect(fs.readFileSync(modulePath, 'utf8')).toBe('module.exports = {}\n')
    })
})
