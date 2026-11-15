import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const fixtureSource = fileURLToPath(new URL('../fixtures/sample-app', import.meta.url))

const gitConfig = [
    '-c', 'user.name=dev-bubbles',
    '-c', 'user.email=dev-bubbles@localhost',
    '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false',
]

function git(cwd: string, args: string[]): void {
    execFileSync('git', [...gitConfig, ...args], { cwd, stdio: 'pipe' })
}

export function makeFixture(): string {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-fixture-'))
    try {
        fs.cpSync(fixtureSource, target, { recursive: true })
        git(target, ['init'])
        git(target, ['add', '-A'])
        git(target, ['commit', '-m', 'Initial commit'])
    } catch (error) {
        fs.rmSync(target, { recursive: true, force: true })
        throw error
    }
    return target
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.log(makeFixture())
}
