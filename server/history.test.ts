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
})
