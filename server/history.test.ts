import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import { listCommits } from './history.ts'

const repos: string[] = []

function git(cwd: string, ...args: string[]): string {
    const identity = ['-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@localhost', '-c', 'commit.gpgsign=false']
    return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' }).trim()
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true })
})

describe('listCommits', () => {
    it('lists the commits on HEAD newest first', async () => {
        const repo = makeFixture()
        repos.push(repo)
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
        repos.push(repo)
        git(repo, 'init')
        expect(await listCommits(repo)).toEqual([])
    })
})
