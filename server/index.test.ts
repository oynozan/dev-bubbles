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
import type { Snapshot, TreeNode } from '../shared/schema.ts'
import { startServer } from './index.ts'

type EventReader = {
    next(timeoutMs?: number): Promise<Snapshot>
    close(): void
}

function findNode(root: TreeNode, id: string): TreeNode | undefined {
    if (root.id === id) return root
    for (const child of root.children ?? []) {
        const found = findNode(child, id)
        if (found) return found
    }
    return undefined
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
    let events: EventReader

    beforeAll(async () => {
        fixtureDir = makeFixture()
        server = await startServer({ repo: path.join(fixtureDir, 'src'), port: 0, trackedOnly: false })
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

    it('sends the current snapshot of the repo root on connect', async () => {
        const snapshot = await events.next()
        expect(snapshot.root).toMatchObject({ id: ROOT_ID, label: path.basename(fixtureDir) })
        expect(findNode(snapshot.root, 'file:src/auth/session.ts')?.loc).toBeGreaterThan(0)
        expect(snapshot.errors).toEqual([])
    })

    it('pushes a snapshot within 1 s when a file is created, grown and deleted', async () => {
        await events.next()
        const filePath = path.join(fixtureDir, 'src', 'live.ts')
        fs.writeFileSync(filePath, 'export const a = 1\n')
        const created = await waitForSnapshot(events, (snapshot) => findNode(snapshot.root, 'file:src/live.ts') !== undefined)
        expect(findNode(created.root, 'file:src/live.ts')?.loc).toBe(1)
        fs.appendFileSync(filePath, 'export const b = 2\nexport const c = 3\n')
        await waitForSnapshot(events, (snapshot) => findNode(snapshot.root, 'file:src/live.ts')?.loc === 3)
        fs.rmSync(filePath)
        await waitForSnapshot(events, (snapshot) => findNode(snapshot.root, 'file:src/live.ts') === undefined)
    })

    it('skips snapshots that did not change', async () => {
        await events.next()
        fs.mkdirSync(path.join(fixtureDir, '.dev-bubbles'), { recursive: true })
        fs.writeFileSync(path.join(fixtureDir, '.dev-bubbles', 'notes.txt'), 'not part of the map\n')
        await delay(700)
        fs.writeFileSync(path.join(fixtureDir, 'src', 'later.ts'), 'export {}\n')
        const next = await events.next()
        expect(findNode(next.root, 'file:src/later.ts')).toBeDefined()
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

    it('no longer serves the snapshot as JSON', async () => {
        expect((await fetch(`${baseUrl}/api/snapshot`)).status).toBe(404)
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

    it('rejects a request for a host that is not local', async () => {
        const status = await new Promise<number | undefined>((resolve, reject) => {
            http.get(`${baseUrl}/api/events`, { headers: { host: 'attacker.example' } }, (response) => {
                response.resume()
                resolve(response.statusCode)
            }).on('error', reject)
        })
        expect(status).toBe(403)
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
