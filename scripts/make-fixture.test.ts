import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFixture } from './make-fixture.ts'

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

describe('makeFixture', () => {
    let fixtureDir: string

    beforeAll(() => {
        fixtureDir = makeFixture()
    })

    afterAll(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true })
    })

    it('commits the sample app into its own git repo', () => {
        expect(path.isAbsolute(fixtureDir)).toBe(true)
        expect(git(fixtureDir, ['ls-files']).split('\n')).toEqual(expect.arrayContaining([
            'src/auth/session.ts',
            'src/api/routes/login.ts',
            'web/src/LoginPage.tsx',
            'tsconfig.json',
        ]))
    })

    it('leaves a clean working tree', () => {
        expect(git(fixtureDir, ['status', '--porcelain'])).toBe('')
    })
})
