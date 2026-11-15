import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import { ROOT_ID } from '../shared/schema.ts'
import type { FileRef, Snapshot, TreeNode } from '../shared/schema.ts'
import { flattenTree } from './components.ts'
import { startServer } from './index.ts'

type EventReader = {
    next(timeoutMs?: number): Promise<Snapshot>
    close(): void
}

function findFile(root: TreeNode, filePath: string): FileRef | undefined {
    return flattenTree(root).flatMap((node) => node.files ?? []).find((file) => file.path === filePath)
}

function filePaths(root: TreeNode): string[] {
    return flattenTree(root).flatMap((node) => node.files ?? []).map((file) => file.path)
}

function git(cwd: string, ...args: string[]): string {
    const identity = ['-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@localhost', '-c', 'commit.gpgsign=false']
    return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' }).trim()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No snapshot within ${timeoutMs} ms`)), timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function openEvents(baseUrl: string): Promise<EventReader> {
    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    if (!response.body) throw new Error('The event stream has no body')
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    const readMessage = async (): Promise<Snapshot> => {
        while (!buffer.includes('\n\n')) {
            const { value, done } = await reader.read()
            if (done) throw new Error('The event stream ended')
            buffer += value
        }
        const end = buffer.indexOf('\n\n')
        const message = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        expect(message.startsWith('data: ')).toBe(true)
        return JSON.parse(message.slice('data: '.length))
    }
    return {
        next: (timeoutMs = 1000) => withTimeout(readMessage(), timeoutMs),
        close: () => controller.abort(),
    }
}

async function waitForSnapshot(events: EventReader, matches: (snapshot: Snapshot) => boolean): Promise<Snapshot> {
    const deadline = Date.now() + 1000
    for (;;) {
        const snapshot = await events.next(deadline - Date.now())
        if (matches(snapshot)) return snapshot
    }
}

function postLayout(baseUrl: string, body: string, contentType = 'application/json'): Promise<Response> {
    return fetch(`${baseUrl}/api/layout`, { method: 'POST', headers: { 'Content-Type': contentType }, body })
}

describe('startServer', () => {
    let fixtureDir: string
    let server: Server
    let baseUrl: string
    let listeningAt: number
    let events: EventReader

    beforeAll(async () => {
        fixtureDir = makeFixture()
        server = await startServer({ repo: path.join(fixtureDir, 'src'), port: 0, trackedOnly: false })
        listeningAt = Date.now()
        const { port } = server.address() as AddressInfo
        baseUrl = `http://127.0.0.1:${port}`
    })

    afterAll(async () => {
        const closed = new Promise((resolve) => server.close(resolve))
        server.closeAllConnections()
        await closed
        fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 10 })
    })

    beforeEach(async () => {
        events = await openEvents(baseUrl)
    })

    afterEach(() => {
        events.close()
    })

    it('listens before the first scan and sends that scan once it is done', async () => {
        const snapshot = await events.next()
        expect(Date.parse(snapshot.generatedAt)).toBeGreaterThanOrEqual(listeningAt)
        expect(snapshot.root).toMatchObject({ id: ROOT_ID, label: path.basename(fixtureDir) })
        expect(findFile(snapshot.root, 'src/auth/session.ts')?.loc).toBeGreaterThan(0)
        expect(snapshot.errors).toEqual([])
    })

    it('pushes a snapshot within 1 s when a file is created, grown and deleted', async () => {
        await events.next()
        const filePath = path.join(fixtureDir, 'src', 'live.ts')
        fs.writeFileSync(filePath, 'export const a = 1\n')
        const created = await waitForSnapshot(events, (snapshot) => findFile(snapshot.root, 'src/live.ts') !== undefined)
        expect(findFile(created.root, 'src/live.ts')?.loc).toBe(1)
        fs.appendFileSync(filePath, 'export const b = 2\nexport const c = 3\n')
        await waitForSnapshot(events, (snapshot) => findFile(snapshot.root, 'src/live.ts')?.loc === 3)
        fs.rmSync(filePath)
        await waitForSnapshot(events, (snapshot) => findFile(snapshot.root, 'src/live.ts') === undefined)
    })

    it('skips snapshots that did not change', async () => {
        await events.next()
        fs.mkdirSync(path.join(fixtureDir, '.dev-bubbles'), { recursive: true })
        fs.writeFileSync(path.join(fixtureDir, '.dev-bubbles', 'notes.txt'), 'not part of the map\n')
        await delay(700)
        fs.writeFileSync(path.join(fixtureDir, 'src', 'later.ts'), 'export {}\n')
        const next = await events.next()
        expect(findFile(next.root, 'src/later.ts')).toBeDefined()
    })

    it('saves a pin to layout.json and pushes it in the next snapshot', async () => {
        await events.next()
        const layoutPath = path.join(fixtureDir, '.dev-bubbles', 'layout.json')
        const response = await postLayout(baseUrl, JSON.stringify({ id: 'dir:src/auth', pin: [12.5, -40] }))
        expect(response.status).toBe(204)
        expect(JSON.parse(fs.readFileSync(layoutPath, 'utf8'))).toEqual({ version: 1, pins: { 'dir:src/auth': [12.5, -40] } })
        expect((await events.next()).pins).toEqual({ 'dir:src/auth': [12.5, -40] })
        expect((await postLayout(baseUrl, JSON.stringify({ id: 'dir:src/auth', pin: null }))).status).toBe(204)
        expect((await events.next()).pins).toEqual({})
    })

    it('rejects layout requests that are not a JSON pin', async () => {
        const pin = JSON.stringify({ id: 'dir:src', pin: [1, 2] })
        expect((await postLayout(baseUrl, pin, 'text/plain')).status).toBe(415)
        expect((await postLayout(baseUrl, `{"id":"${'x'.repeat(70 * 1024)}","pin":null}`)).status).toBe(413)
        expect((await postLayout(baseUrl, '{"id":')).status).toBe(400)
        expect((await postLayout(baseUrl, JSON.stringify({ id: 'dir:src', pin: [1] }))).status).toBe(400)
        expect((await fetch(`${baseUrl}/api/layout`)).status).toBe(405)
    })

    it.each(['/..%2f..%2fpackage.json', '/..%5c..%5cpackage.json'])('blocks path traversal via %s', async (attempt) => {
        const response = await fetch(`${baseUrl}${attempt}`)
        expect(response.status).toBe(404)
        expect(await response.text()).not.toContain('dev-bubbles')
    })

    it.each(['/%E0%A4%A', '/%00'])('rejects the malformed path %s', async (attempt) => {
        const response = await fetch(`${baseUrl}${attempt}`)
        expect(response.status).toBe(400)
    })

    it.each(['/api/events', '/api/snapshot?commit=abcd'])('rejects a request to %s for a host that is not local', async (route) => {
        const status = await new Promise<number | undefined>((resolve, reject) => {
            http.get(`${baseUrl}${route}`, { headers: { host: 'attacker.example' } }, (response) => {
                response.resume()
                resolve(response.statusCode)
            }).on('error', reject)
        })
        expect(status).toBe(403)
    })

    it.each(['cross-site', 'same-site'])('rejects a %s request for a past commit', async (site) => {
        const response = await fetch(`${baseUrl}/api/snapshot?commit=abcd`, { headers: { 'Sec-Fetch-Site': site } })
        expect(response.status).toBe(403)
    })
})

describe('startServer history', () => {
    let repo: string
    let server: Server
    let baseUrl: string
    let first: string
    let second: string

    function getSnapshot(query: string): Promise<Response> {
        return fetch(`${baseUrl}/api/snapshot${query}`)
    }

    async function liveSnapshot(): Promise<Snapshot> {
        const events = await openEvents(baseUrl)
        try {
            return await events.next(5000)
        } finally {
            events.close()
        }
    }

    beforeAll(async () => {
        repo = makeFixture()
        first = git(repo, 'rev-parse', 'HEAD')
        fs.mkdirSync(path.join(repo, '.dev-bubbles'))
        fs.writeFileSync(path.join(repo, '.dev-bubbles', 'components.json'), JSON.stringify({
            version: 1,
            ignore: ['src/config/**'],
            components: [{ id: 'auth', label: 'Auth', include: ['src/auth/**'] }],
        }))
        fs.writeFileSync(path.join(repo, 'src', 'added.ts'), 'export {}\n')
        fs.rmSync(path.join(repo, 'src', 'lib', 'logger.ts'))
        git(repo, 'add', '-A')
        git(repo, 'commit', '-m', 'Add a file and the components, drop the logger')
        second = git(repo, 'rev-parse', 'HEAD')
        fs.appendFileSync(path.join(repo, 'src', 'auth', 'session.ts'), 'export const draft = 1\n')
        fs.writeFileSync(path.join(repo, 'src', 'staged.ts'), 'export {}\n')
        git(repo, 'add', 'src/staged.ts')
        fs.writeFileSync(path.join(repo, 'src', 'untracked.ts'), 'export {}\n')
        server = await startServer({ repo, port: 0, trackedOnly: false })
        const { port } = server.address() as AddressInfo
        baseUrl = `http://127.0.0.1:${port}`
    })

    afterAll(async () => {
        const closed = new Promise((resolve) => server.close(resolve))
        server.closeAllConnections()
        await closed
        fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10 })
    })

    it('lists the commits newest first in the live snapshot', async () => {
        const live = await liveSnapshot()
        expect(live.commits.map((commit) => commit.sha)).toEqual([second, first])
        expect(live).not.toHaveProperty('commit')
    })

    it('serves a past commit with the current components and leaves the index and working tree alone', async () => {
        const gitState = () => [git(repo, 'status', '--porcelain'), git(repo, 'ls-files', '--stage'), git(repo, 'worktree', 'list')]
        const before = gitState()
        const live = await liveSnapshot()
        const response = await getSnapshot(`?commit=${first.slice(0, 8)}`)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
        const past: Snapshot = await response.json()
        expect(past).toMatchObject({ commit: first, commits: [], bugs: [], errors: [] })
        expect(past.root.children?.map((child) => child.id)).toEqual(['auth', 'unmapped'])
        const pastPaths = filePaths(past.root)
        const livePaths = filePaths(live.root)
        const laterPaths = ['src/added.ts', 'src/staged.ts', 'src/untracked.ts']
        expect(pastPaths).toContain('src/lib/logger.ts')
        expect(livePaths).not.toContain('src/lib/logger.ts')
        expect(livePaths).toEqual(expect.arrayContaining(laterPaths))
        expect(pastPaths.filter((filePath) => laterPaths.includes(filePath))).toEqual([])
        expect(pastPaths.filter((filePath) => filePath.startsWith('src/config/'))).toEqual([])
        const sessionLoc = (root: TreeNode) => findFile(root, 'src/auth/session.ts')?.loc ?? 0
        expect(sessionLoc(live.root)).toBe(sessionLoc(past.root) + 1)
        expect(past.edges).toContainEqual(expect.objectContaining({ from: 'file:web/src/LoginPage.tsx', kind: 'http' }))
        expect(gitState()).toEqual(before)
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(second)
    })

    it('leaves the config folder out of a commit that tracks it', async () => {
        const past: Snapshot = await (await getSnapshot(`?commit=${second}`)).json()
        expect(past.commit).toBe(second)
        expect(filePaths(past.root)).toContain('src/added.ts')
        expect(filePaths(past.root).filter((filePath) => filePath.startsWith('.dev-bubbles/'))).toEqual([])
    })

    it.each(['', '?commit=', '?commit=abc', `?commit=${'a'.repeat(65)}`, '?commit=HEAD', '?commit=--all', '?commit=abcd%20'])(
        'answers 400 for the malformed query "%s"',
        async (query) => {
            expect((await getSnapshot(query)).status).toBe(400)
        },
    )

    it('answers 404 for a commit the repo does not have', async () => {
        expect((await getSnapshot('?commit=deadbeefdeadbeef')).status).toBe(404)
        expect((await getSnapshot(`?commit=${git(repo, 'rev-parse', 'HEAD^{tree}')}`)).status).toBe(404)
    })

    it('answers 405 for other methods', async () => {
        expect((await fetch(`${baseUrl}/api/snapshot?commit=${first}`, { method: 'POST' })).status).toBe(405)
    })

    it('pushes the new commit list within 1 s of a commit that leaves the index alone', async () => {
        const events = await openEvents(baseUrl)
        try {
            await events.next(5000)
            git(repo, 'commit', '--allow-empty', '-m', 'Live commit')
            const next = await waitForSnapshot(events, (snapshot) => snapshot.commits[0]?.subject === 'Live commit')
            expect(next.commits).toHaveLength(3)
        } finally {
            events.close()
        }
    })
})

describe('startServer in a SHA-256 repository', () => {
    it('lists the commits and serves one by its full sha', async () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-sha256-'))
        git(repo, 'init', '--object-format=sha256')
        fs.writeFileSync(path.join(repo, 'a.ts'), 'export {}\n')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-m', 'Initial commit')
        const server = await startServer({ repo, port: 0, trackedOnly: false })
        try {
            const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
            const events = await openEvents(baseUrl)
            const live = await events.next(5000).finally(() => events.close())
            const [commit] = live.commits
            expect(commit.sha).toMatch(/^[0-9a-f]{64}$/)
            const response = await fetch(`${baseUrl}/api/snapshot?commit=${commit.sha}`)
            expect(response.status).toBe(200)
            expect((await response.json() as Snapshot).commit).toBe(commit.sha)
        } finally {
            const closed = new Promise((resolve) => server.close(resolve))
            server.closeAllConnections()
            await closed
            fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10 })
        }
    })
})

describe('startServer outside a git repository', () => {
    it('rejects with a clear error', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-plain-'))
        vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(dir))
        try {
            await expect(startServer({ repo: dir, port: 0, trackedOnly: false })).rejects.toThrow(/not inside a git repository/i)
        } finally {
            vi.unstubAllEnvs()
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
