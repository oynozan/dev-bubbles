import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const cliPath = path.join(packageRoot, 'bin', 'cli.ts')
const cliFile = path.join(packageRoot, 'dist', 'bin', 'cli.js').replaceAll('\\', '/')
// An absolute loader URL, since the hooks and bug commands run with the temp repo as their working directory
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

function runCli(...args: string[]) {
    return runCliIn(packageRoot, args)
}

function runCliIn(cwd: string, args: string[], input?: string) {
    const result = spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], { cwd, input, encoding: 'utf8' })
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
        return path.join(repoDir, '.dev', name)
    }

    function writeConfig(name: string, content: unknown, repoDir = repo): void {
        fs.writeFileSync(configFile(name, repoDir), JSON.stringify(content))
    }

    function readConfig(name: string, repoDir = repo) {
        return JSON.parse(fs.readFileSync(configFile(name, repoDir), 'utf8'))
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
        expect(gitignore).toEqual(expect.arrayContaining(['node_modules', '.dev/bugs.json', '.dev/layout.json']))
        expect(fs.existsSync(path.join(freshRepo, '.claude', 'commands', 'map.md'))).toBe(true)
        expect(fs.existsSync(path.join(freshRepo, '.claude', 'skills', 'dev-bubbles', 'SKILL.md'))).toBe(true)
        expect(stdout).toContain(path.join(packageRoot, 'templates', 'claude-snippet.md'))
    })

    it('init never overwrites existing files', () => {
        const freshRepo = makeRepo()
        const manifest = '{ "version": 1, "components": [], "ignore": [] }'
        fs.mkdirSync(path.join(freshRepo, '.dev'))
        fs.writeFileSync(configFile('components.json', freshRepo), manifest)
        runCli('init', freshRepo)
        const { status, stdout } = runCli('init', freshRepo)
        expect(status).toBe(0)
        expect(fs.readFileSync(configFile('components.json', freshRepo), 'utf8')).toBe(manifest)
        expect(stdout).toContain('skipped')
        const gitignore = fs.readFileSync(path.join(freshRepo, '.gitignore'), 'utf8')
        expect(gitignore.match(/\.dev\/bugs\.json/g)).toHaveLength(1)
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
        expect(stdout).toMatch(/Components with both sub-components and own files[^\n]*\n {2}\(none\)\n/)
    })

    it('summary lists the own files of components that also have sub-components', () => {
        writeConfig('components.json', {
            version: 1,
            components: [{
                id: 'auth',
                label: 'Auth',
                include: ['src/auth/**'],
                children: [{ id: 'auth.google', label: 'Google', include: ['src/auth/oauth/google/**'] }],
            }],
        })
        const { status, stdout } = runCli('summary', repo)
        expect(status).toBe(0)
        expect(stdout).toContain('  auth, Auth: 6\n    auth.google, Google: 2\n')
        expect(stdout).toContain([
            'move them into a sub-component):',
            '  auth, Auth: 4 files',
            '    src/auth/oauth/apple/callback.ts',
            '    src/auth/oauth/apple/client.ts',
            '    src/auth/oauth/providers.ts',
            '    src/auth/session.ts',
        ].join('\n'))
    })

    it('rejects a directory outside any git repository', () => {
        const { status, stderr } = runCli('validate', path.join(repo, '..'))
        expect(status).toBe(1)
        expect(stderr).toContain('Not inside a git repository')
    })

    describe('bug', () => {
        let bugRepo: string

        function bug(...args: string[]) {
            return runCliIn(bugRepo, ['bug', ...args])
        }

        beforeAll(() => {
            bugRepo = makeRepo()
            runCli('init', bugRepo)
            writeConfig('components.json', authAndBilling, bugRepo)
        })

        it('open adds an open bug and prints its id', () => {
            const { status, stdout } = bug('open', 'Login', 'button does nothing')
            expect(status).toBe(0)
            expect(stdout).toBe('b1\n')
            expect(readConfig('bugs.json', bugRepo).bugs).toEqual([
                { id: 'b1', title: 'Login button does nothing', status: 'open', marks: [], updatedAt: expect.any(String) },
            ])
            expect(bug('open', 'Billing page is blank').stdout).toBe('b2\n')
        })

        it('mark adds component and file marks and replaces the mark on the same target', () => {
            const before = readConfig('bugs.json', bugRepo).bugs[0].updatedAt
            expect(bug('mark', 'b1', 'auth', 'suspected', 'handles', 'the login form').stdout).toBe('Marked auth as suspected on b1\n')
            const absolutePath = path.join(bugRepo, 'src', 'auth', 'session.ts').replaceAll('/', '\\')
            expect(bug('mark', 'b1', absolutePath, 'suspected').stdout).toBe('Marked src/auth/session.ts as suspected on b1\n')
            expect(bug('mark', 'b1', 'src\\auth\\session.ts', 'confirmed', 'drops the cookie').status).toBe(0)
            const [b1] = readConfig('bugs.json', bugRepo).bugs
            expect(b1.marks).toEqual([
                { component: 'auth', state: 'suspected', reason: 'handles the login form' },
                { file: 'src/auth/session.ts', state: 'confirmed', reason: 'drops the cookie' },
            ])
            expect(new Date(b1.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime())
        })

        it('list prints the open bugs with their marks', () => {
            const { status, stdout } = bug('list')
            expect(status).toBe(0)
            expect(stdout).toBe([
                'b1 Login button does nothing',
                '  suspected auth: handles the login form',
                '  confirmed src/auth/session.ts: drops the cookie',
                'b2 Billing page is blank',
                '',
            ].join('\n'))
        })

        it('clear removes the mark on a target', () => {
            expect(bug('clear', 'b1', 'auth').stdout).toBe('Cleared the mark on auth from b1\n')
            expect(readConfig('bugs.json', bugRepo).bugs[0].marks).toEqual([
                { file: 'src/auth/session.ts', state: 'confirmed', reason: 'drops the cookie' },
            ])
            expect(bug('clear', 'b1', 'auth').status).toBe(1)
        })

        it('fix sets the bug to fixed and keeps its marks', () => {
            expect(bug('fix', 'b1').status).toBe(0)
            const [b1] = readConfig('bugs.json', bugRepo).bugs
            expect(b1).toMatchObject({ status: 'fixed', marks: [{ file: 'src/auth/session.ts', state: 'confirmed' }] })
            expect(bug('list').stdout).toBe('b2 Billing page is blank\n')
        })

        it('rejects an unknown target and names close component ids', () => {
            const before = fs.readFileSync(configFile('bugs.json', bugRepo), 'utf8')
            const { status, stderr } = bug('mark', 'b2', 'auht', 'suspected')
            expect(status).toBe(1)
            expect(stderr).toContain('Unknown target auht')
            expect(stderr).toContain('Close component ids: auth, billing')
            expect(bug('mark', 'b2', 'src/auth/missing.ts', 'suspected').status).toBe(1)
            expect(bug('mark', 'b9', 'auth', 'suspected').stderr).toContain('No bug b9')
            expect(bug('mark', 'b2', 'auth', 'maybe').status).toBe(1)
            expect(fs.readFileSync(configFile('bugs.json', bugRepo), 'utf8')).toBe(before)
        })

        it('keeps an invalid bugs.json and reports its errors', () => {
            const invalid = '{ "version": 1, "bugs": [{ "id": "b1" }] }'
            fs.writeFileSync(configFile('bugs.json', bugRepo), invalid)
            const { status, stderr } = bug('open', 'Another bug')
            expect(status).toBe(1)
            expect(stderr).toContain('bugs.json: bugs[0].title: ')
            expect(fs.readFileSync(configFile('bugs.json', bugRepo), 'utf8')).toBe(invalid)
        })
    })

    describe('hook', () => {
        let hookRepo: string

        function hook(event: string, input: unknown) {
            return runCliIn(hookRepo, ['hook', event], typeof input === 'string' ? input : JSON.stringify(input))
        }

        beforeAll(() => {
            hookRepo = makeRepo()
            runCli('init', hookRepo)
        })

        it.each([
            'this part doesn\'t work',
            'Login is broken again',
            'the save button won’t respond',
            'getting a 500 when I pay',
            'total shows NaN',
        ])('prompt adds the bug steps to "%s"', (prompt) => {
            const { status, stdout } = hook('prompt', { prompt })
            expect(status).toBe(0)
            expect(stdout).toContain(`${cliFile} bug open "<symptom in the user's words>"`)
            expect(stdout).toContain('bug mark <id> <component> suspected')
            expect(stdout).toContain('bug fix <id>')
            expect(stdout).toContain('bug list')
        })

        it.each(['add a dark mode toggle', 'rename the billing page', 'explain how sessions work'])(
            'prompt prints nothing for "%s"',
            (prompt) => {
                const { status, stdout } = hook('prompt', { prompt })
                expect(status).toBe(0)
                expect(stdout).toBe('')
            },
        )

        it('stop blocks the turn while a file matches no component', () => {
            writeConfig('components.json', { version: 1, components: [{ id: 'app', label: 'App', include: ['**'], exclude: ['web/**'] }] }, hookRepo)
            const { status, stdout } = hook('stop', { stop_hook_active: false })
            expect(status).toBe(0)
            const output = JSON.parse(stdout)
            expect(output.decision).toBe('block')
            expect(output.reason).toContain('The Dev Bubbles map is out of date')
            expect(output.reason).toContain('- components.json: web/src/App.tsx matches no component')
            expect(output.reason).toContain('Update .dev/components.json')
        })

        it('stop is silent when it already blocked once in this turn', () => {
            const { status, stdout } = hook('stop', { stop_hook_active: true })
            expect(status).toBe(0)
            expect(stdout).toBe('')
        })

        it('stop is silent when the map is up to date', () => {
            writeConfig('components.json', { version: 1, components: [{ id: 'app', label: 'App', include: ['**'] }] }, hookRepo)
            const { status, stdout } = hook('stop', { stop_hook_active: false })
            expect(status).toBe(0)
            expect(stdout).toBe('')
        })

        it('exits 0 and prints nothing on input it cannot read', () => {
            expect(hook('stop', 'not json')).toMatchObject({ status: 0, stdout: '', stderr: '' })
            expect(hook('unknown', {})).toMatchObject({ status: 0, stdout: '', stderr: '' })
        })
    })

    it('serve prints its URL, records it in server.json and streams snapshots there', async () => {
        const freshRepo = makeRepo()
        const child = spawn(process.execPath, ['--import', tsxLoader, cliPath, 'serve', freshRepo, '--port', '0'], {
            cwd: packageRoot,
        })
        try {
            const line = await readLine(child)
            expect(line).toContain(`Dev Bubbles serving ${freshRepo} at http://127.0.0.1:`)
            const url = line.slice(line.lastIndexOf(' ') + 1)
            expect(readConfig('server.json', freshRepo)).toEqual({ pid: child.pid, url })
            const response = await fetch(new URL('api/events', url))
            const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
            const firstChunk = await reader?.read()
            expect(firstChunk?.value).toMatch(/^data: \{"root":/)
            await reader?.cancel()
        } finally {
            child.kill()
            // Windows cannot delete the repo in afterAll while the server still watches it
            if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
        }
        // Windows ends a killed process without running its exit handlers
        if (process.platform !== 'win32') expect(fs.existsSync(configFile('server.json', freshRepo))).toBe(false)
    })

    it('up starts one background server and reuses it, and down stops it', async () => {
        const freshRepo = makeRepo()
        runCli('init', freshRepo)
        // Holding the default port shows the fallback and keeps the test off a server the user runs there
        const blocker = net.createServer()
        await new Promise<void>((resolve) => blocker.once('error', () => resolve()).listen(4747, '127.0.0.1', resolve))
        let pid: number | undefined
        try {
            const first = runCli('up', freshRepo)
            expect(first).toMatchObject({ status: 0, stdout: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/\n$/) })
            const url = first.stdout.trim()
            expect(url).not.toBe('http://127.0.0.1:4747/')
            pid = readConfig('server.json', freshRepo).pid
            expect(readConfig('server.json', freshRepo)).toEqual({ pid, url })
            expect(isAlive(pid!)).toBe(true)

            expect(runCli('up', freshRepo).stdout).toBe(`${url}\n`)
            expect(readConfig('server.json', freshRepo).pid).toBe(pid)

            const session = runCliIn(freshRepo, ['hook', 'session'], '{}')
            expect(session.stdout).toContain(`live bubble map of this repo at ${url}`)
            expect(session.stdout).toContain(`${cliFile} bug open "<symptom>"`)
            expect(session.stdout).toContain('This repo is not mapped yet')
            expect(session.stdout.split(/\s+/).length).toBeLessThan(130)
            expect(readConfig('server.json', freshRepo).pid).toBe(pid)

            expect(runCli('down', freshRepo).stdout).toBe(`Stopped the Dev Bubbles server at ${url} (pid ${pid})\n`)
            await vi.waitFor(() => expect(isAlive(pid!)).toBe(false), { timeout: 5000 })
            expect(fs.existsSync(configFile('server.json', freshRepo))).toBe(false)
            expect(runCli('down', freshRepo).stdout).toBe('No Dev Bubbles server is running for this repo\n')
        } finally {
            blocker.close()
            if (pid !== undefined && isAlive(pid)) {
                process.kill(pid)
                await vi.waitFor(() => expect(isAlive(pid!)).toBe(false), { timeout: 5000 })
            }
        }
    })
})

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

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
