import fs from 'node:fs'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import type { Snapshot } from '../shared/schema.ts'
import { startServer } from './index.ts'

describe('startServer', () => {
    let fixtureDir: string
    let server: Server
    let baseUrl: string

    beforeAll(async () => {
        fixtureDir = makeFixture()
        server = await startServer({ repo: fixtureDir, port: 0 })
        const { port } = server.address() as AddressInfo
        baseUrl = `http://127.0.0.1:${port}`
    })

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve))
        fs.rmSync(fixtureDir, { recursive: true, force: true })
    })

    it('serves the snapshot as JSON', async () => {
        const response = await fetch(`${baseUrl}/api/snapshot`)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('application/json')
        const snapshot: Snapshot = await response.json()
        expect(snapshot.root.id).toBe('dir:')
    })

    it('returns 404 for unknown paths', async () => {
        const response = await fetch(`${baseUrl}/api/nope`)
        expect(response.status).toBe(404)
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
            http.get(`${baseUrl}/api/snapshot`, { headers: { host: 'attacker.example' } }, (response) => {
                response.resume()
                resolve(response.statusCode)
            }).on('error', reject)
        })
        expect(status).toBe(403)
    })
})
