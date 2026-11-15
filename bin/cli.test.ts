import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
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

const authAndBilling = {
    version: 1,
    components: [
        { id: 'auth', label: 'Auth', include: ['src/auth/**'] },
        { id: 'billing', label: 'Billing', include: ['src/billing/**'] },
    ],
}

describe('dev-bubbles CLI', { timeout: 30_000 }, () => {
    const repos: string[] = []
    let repo: string

    function makeRepo(): string {
        const fixture = makeFixture()
        repos.push(fixture)
        return fixture
    }

    function configFile(name: string, repoDir = repo): string {
        return path.join(repoDir, '.dev-bubbles', name)
    }

    function writeConfig(name: string, content: unknown): void {
        fs.writeFileSync(configFile(name), JSON.stringify(content))
    }

    beforeAll(() => {
        repo = makeRepo()
        runCli('init', repo)
    })

    afterAll(() => {
        for (const fixture of repos) fs.rmSync(fixture, { recursive: true, force: true })
    })

    it('init creates the config files, ignores the local ones and installs the agent files', () => {
        const freshRepo = makeRepo()
        const { status, stdout } = runCli('init', freshRepo)
        expect(status).toBe(0)
        expect(fs.readFileSync(configFile('components.json', freshRepo), 'utf8')).toBe('{\n    "version": 1,\n    "components": []\n}\n')
        expect(JSON.parse(fs.readFileSync(configFile('bugs.json', freshRepo), 'utf8'))).toEqual({ version: 1, bugs: [] })
        const gitignore = fs.readFileSync(path.join(freshRepo, '.gitignore'), 'utf8').split('\n')
        expect(gitignore).toEqual(expect.arrayContaining(['node_modules', '.dev-bubbles/bugs.json', '.dev-bubbles/layout.json']))
        expect(fs.existsSync(path.join(freshRepo, '.claude', 'commands', 'map.md'))).toBe(true)
        expect(fs.existsSync(path.join(freshRepo, '.claude', 'skills', 'dev-bubbles', 'SKILL.md'))).toBe(true)
        expect(stdout).toContain(path.join(packageRoot, 'templates', 'claude-snippet.md'))
    })

    it('init never overwrites existing files', () => {
        const freshRepo = makeRepo()
        const manifest = '{ "version": 1, "components": [], "ignore": [] }'
        fs.mkdirSync(path.join(freshRepo, '.dev-bubbles'))
        fs.writeFileSync(configFile('components.json', freshRepo), manifest)
        runCli('init', freshRepo)
        const { status, stdout } = runCli('init', freshRepo)
        expect(status).toBe(0)
        expect(fs.readFileSync(configFile('components.json', freshRepo), 'utf8')).toBe(manifest)
        expect(stdout).toContain('skipped')
        const gitignore = fs.readFileSync(path.join(freshRepo, '.gitignore'), 'utf8')
        expect(gitignore.match(/\.dev-bubbles\/bugs\.json/g)).toHaveLength(1)
    })

    it('validate passes on a fresh setup', () => {
        writeConfig('components.json', { version: 1, components: [] })
        writeConfig('bugs.json', { version: 1, bugs: [] })
        const { status, stdout } = runCli('validate', repo)
        expect(stdout.trim()).toBe('OK')
        expect(status).toBe(0)
    })

    it('validate reports schema, manifest, coverage and bug errors and exits 1', () => {
        writeConfig('components.json', { ...authAndBilling, httpEdges: [{ from: 'web', to: 'auth' }] })
        writeConfig('bugs.json', {
            version: 1,
            bugs: [{ id: 'b1', title: 'Login', status: 'open', marks: [{ component: 'auth.x', state: 'suspected' }] }],
        })
        const { status, stdout } = runCli('validate', '--repo', repo)
        expect(status).toBe(1)
        expect(stdout).toContain('components.json: httpEdges[0].from: unknown component id web')
        expect(stdout).toContain('components.json: components[1]: component billing has no files')
        expect(stdout).toContain('components.json: src/lib/url.ts matches no component')
        expect(stdout).toContain('bugs.json: bugs[0].marks[0].component: unknown component auth.x')
        expect(stdout.trim().split('\n').at(-1)).toMatch(/^\d+ errors$/)
    })

    it('validate prints schema errors with their JSON path', () => {
        writeConfig('bugs.json', { version: 1, bugs: [{ id: 'b1', title: 'x', status: 'closed', marks: [] }] })
        const { status, stdout } = runCli('validate', repo)
        expect(status).toBe(1)
        expect(stdout).toContain('bugs.json: bugs[0].status: ')
    })

    it('summary lists directories, components, unmapped files and unmatched calls', () => {
        writeConfig('components.json', authAndBilling)
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

    it('serve prints the URL it listens on and streams snapshots there', async () => {
        const freshRepo = makeRepo()
        const child = spawn(process.execPath, ['--import', 'tsx', cliPath, 'serve', freshRepo, '--port', '0'], {
            cwd: packageRoot,
        })
        try {
            const line = await readLine(child)
            expect(line).toContain(`Dev Bubbles serving ${freshRepo} at http://127.0.0.1:`)
            const url = line.slice(line.lastIndexOf(' ') + 1)
            const response = await fetch(`${url}/api/events`)
            const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
            const firstChunk = await reader?.read()
            expect(firstChunk?.value).toMatch(/^data: \{"root":/)
            await reader?.cancel()
        } finally {
            child.kill()
            // Windows cannot delete the repo in afterAll while the server still watches it
            if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
        }
    })
})

function readLine(child: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolve, reject) => {
        let output = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
            output += chunk
            if (output.includes('\n')) resolve(output.slice(0, output.indexOf('\n')).trim())
        })
        child.once('exit', (code) => reject(new Error(`serve exited with ${code}`)))
    })
}
