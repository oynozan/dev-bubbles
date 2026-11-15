import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const cliPath = path.join(packageRoot, 'bin', 'cli.ts')

function runCli(...args: string[]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
        cwd: packageRoot,
        encoding: 'utf8',
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('dev-bubbles CLI', { timeout: 30_000 }, () => {
    let repo: string
    const configFile = (name: string) => path.join(repo, '.dev-bubbles', name)

    beforeAll(() => {
        repo = makeFixture()
    })

    afterAll(() => {
        fs.rmSync(repo, { recursive: true, force: true })
    })

    it('init creates the config files, ignores the local ones and installs the agent files', () => {
        const { status, stdout } = runCli('init', repo)
        expect(status).toBe(0)
        expect(JSON.parse(fs.readFileSync(configFile('components.json'), 'utf8'))).toEqual({ version: 1, components: [] })
        expect(JSON.parse(fs.readFileSync(configFile('bugs.json'), 'utf8'))).toEqual({ version: 1, bugs: [] })
        const gitignore = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8').split('\n')
        expect(gitignore).toEqual(expect.arrayContaining(['node_modules', '.dev-bubbles/bugs.json', '.dev-bubbles/layout.json']))
        expect(fs.existsSync(path.join(repo, '.claude', 'commands', 'map.md'))).toBe(true)
        expect(fs.existsSync(path.join(repo, '.claude', 'skills', 'dev-bubbles', 'SKILL.md'))).toBe(true)
        expect(stdout).toContain(path.join(packageRoot, 'templates', 'claude-snippet.md'))
    })

    it('init never overwrites existing files', () => {
        fs.writeFileSync(configFile('components.json'), '{ "version": 1, "components": [], "ignore": [] }')
        const { status, stdout } = runCli('init', repo)
        expect(status).toBe(0)
        expect(fs.readFileSync(configFile('components.json'), 'utf8')).toBe('{ "version": 1, "components": [], "ignore": [] }')
        expect(stdout).toContain('skipped')
        const gitignore = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')
        expect(gitignore.match(/\.dev-bubbles\/bugs\.json/g)).toHaveLength(1)
    })

    it('validate passes on a fresh setup', () => {
        const { status, stdout } = runCli('validate', repo)
        expect(stdout.trim()).toBe('OK')
        expect(status).toBe(0)
    })

    it('validate reports schema, manifest, coverage and bug errors and exits 1', () => {
        fs.writeFileSync(configFile('components.json'), JSON.stringify({
            version: 1,
            components: [
                { id: 'auth', label: 'Auth', include: ['src/auth/**'] },
                { id: 'billing', label: 'Billing', include: ['src/billing/**'] },
            ],
            httpEdges: [{ from: 'web', to: 'auth' }],
        }))
        fs.writeFileSync(configFile('bugs.json'), JSON.stringify({
            version: 1,
            bugs: [{ id: 'b1', title: 'Login', status: 'open', marks: [{ component: 'auth.x', state: 'suspected' }] }],
        }))
        const { status, stdout } = runCli('validate', '--repo', repo)
        expect(status).toBe(1)
        expect(stdout).toContain('components.json: httpEdges[0].from: unknown component id web')
        expect(stdout).toContain('components.json: components[1]: component billing has no files')
        expect(stdout).toContain('components.json: src/lib/url.ts matches no component')
        expect(stdout).toContain('bugs.json: bug b1: unknown component auth.x')
        expect(stdout.trim().split('\n').at(-1)).toMatch(/^\d+ errors$/)
    })

    it('validate prints schema errors with their JSON path', () => {
        fs.writeFileSync(configFile('bugs.json'), JSON.stringify({ version: 1, bugs: [{ id: 'b1', title: 'x', status: 'closed', marks: [] }] }))
        const { status, stdout } = runCli('validate', repo)
        expect(status).toBe(1)
        expect(stdout).toContain('bugs.json: bugs[0].status: ')
    })

    it('summary lists directories, components, unmapped files and unmatched calls', () => {
        const { status, stdout } = runCli('summary', repo)
        expect(status).toBe(0)
        expect(stdout).toMatch(/^dev-bubbles-fixture-\w+: \d+ files, \d+ LOC/)
        expect(stdout).toMatch(/\n {4}auth\/ {2}6 files, \d+ LOC\n/)
        expect(stdout).toMatch(/src\/api\/routes -> src\/lib: \d+/)
        expect(stdout).toContain('  auth, Auth: 6\n  billing, Billing: 0\n')
        expect(stdout).toContain('  src/lib/url.ts\n')
        expect(stdout).toContain('web/src/App.tsx  POST /api/analytics')
    })

    it('rejects a directory outside any git repository', () => {
        const { status, stderr } = runCli('validate', path.join(repo, '..'))
        expect(status).toBe(1)
        expect(stderr).toContain('Not inside a git repository')
    })
})
