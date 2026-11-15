import fs from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import path from 'node:path'
import { pinRequestSchema } from '../shared/schema.ts'
import type { Snapshot } from '../shared/schema.ts'
import { findGitIndexPath, findRepoRoot } from './inventory.ts'
import { findPackageRoot } from './package-root.ts'
import { createSnapshotSource } from './snapshot.ts'
import type { SnapshotSource } from './snapshot.ts'
import { watchRepo } from './watcher.ts'

export type ServerOptions = {
    repo: string
    port: number
    trackedOnly: boolean
}

type EventStream = {
    open(response: ServerResponse): void
    publish(snapshot: Snapshot): void
}

type RequestContext = {
    snapshots: SnapshotSource
    events: EventStream
    refresh: () => Promise<void>
}

const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
}

const webDir = path.join(findPackageRoot(import.meta.dirname), 'dist', 'web')
const maxLayoutBodySize = 64 * 1024

// Other hostnames are refused so a DNS rebinding page cannot read the repo
const localHostnames = new Set(['127.0.0.1', 'localhost'])

export async function startServer({ repo, port, trackedOnly }: ServerOptions): Promise<Server> {
    const repoRoot = await findRepoRoot(repo)
    const snapshots = createSnapshotSource(repoRoot, { trackedOnly })
    const events = createEventStream(await snapshots.rescan())
    const refresh = async () => events.publish(await snapshots.rescan())
    const server = createServer((request, response) => {
        handleRequest({ snapshots, events, refresh }, request, response).catch((error: unknown) => {
            sendServerError(response, error)
        })
    })
    await listen(server, port)
    const watcher = await watchRepo(repoRoot, await findGitIndexPath(repoRoot), () => void refresh())
    server.on('close', () => void watcher.close())
    // Changes made before the watcher was ready sent no event
    void refresh()
    return server
}

function listen(server: Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject)
            resolve()
        })
    })
}

async function handleRequest(context: RequestContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLocalHost(request.headers.host)) {
        sendText(response, 403, 'Forbidden host')
        return
    }
    const pathname = readPathname(request.url ?? '/')
    if (pathname === undefined) {
        sendText(response, 400, 'Bad request')
        return
    }
    if (pathname === '/api/layout') {
        if (request.method === 'POST') await updatePin(context, request, response)
        else sendMethodNotAllowed(response, 'POST')
    } else if (pathname === '/api/events') {
        if (request.method === 'GET') context.events.open(response)
        else sendMethodNotAllowed(response, 'GET')
    } else if (request.method === 'GET' || request.method === 'HEAD') {
        serveStatic(pathname, response)
    } else {
        sendMethodNotAllowed(response, 'GET, HEAD')
    }
}

function isLocalHost(host: string | undefined): boolean {
    return localHostnames.has(host?.replace(/:\d*$/, '') ?? '')
}

function readPathname(url: string): string | undefined {
    try {
        const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
        return pathname.includes('\0') ? undefined : pathname
    } catch {
        return undefined
    }
}

/* Server-Sent Events */

function createEventStream(initialSnapshot: Snapshot): EventStream {
    const clients = new Set<ServerResponse>()
    let lastContent = contentKey(initialSnapshot)
    let lastMessage = formatEvent(initialSnapshot)
    return {
        open(response) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
            response.write(lastMessage)
            clients.add(response)
            response.on('close', () => clients.delete(response))
        },
        publish(snapshot) {
            const content = contentKey(snapshot)
            if (content === lastContent) return
            lastContent = content
            lastMessage = formatEvent(snapshot)
            for (const client of clients) client.write(lastMessage)
        },
    }
}

function contentKey(snapshot: Snapshot): string {
    return JSON.stringify({ ...snapshot, generatedAt: undefined })
}

function formatEvent(snapshot: Snapshot): string {
    return `data: ${JSON.stringify(snapshot)}\n\n`
}

/* Layout pins */

async function updatePin(context: RequestContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Requiring JSON forces a CORS preflight, so other sites cannot post pins
    if (!isJsonContentType(request.headers['content-type'])) {
        sendText(response, 415, 'Expected Content-Type application/json')
        return
    }
    const body = await readBody(request, maxLayoutBodySize)
    if (body === undefined) {
        sendText(response, 413, 'Request body too large')
        return
    }
    const pinRequest = pinRequestSchema.safeParse(parseJson(body))
    if (!pinRequest.success) {
        sendText(response, 400, 'Expected { "id": string, "pin": [x, y] | null }')
        return
    }
    context.snapshots.setPin(pinRequest.data)
    response.writeHead(204).end()
    void context.refresh()
}

function isJsonContentType(contentType: string | undefined): boolean {
    return contentType?.split(';')[0].trim().toLowerCase() === 'application/json'
}

// Resolves undefined once the body passes the limit and keeps draining the rest
function readBody(request: IncomingMessage, limit: number): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        request.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > limit) resolve(undefined)
            else chunks.push(chunk)
        })
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        request.on('error', reject)
    })
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

/* Static files and responses */

function serveStatic(pathname: string, response: ServerResponse): void {
    const filePath = resolveStaticFile(pathname === '/' ? '/index.html' : pathname)
    if (filePath) {
        const contentType = contentTypes[path.extname(filePath)] ?? 'application/octet-stream'
        send(response, 200, contentType, fs.readFileSync(filePath))
    } else if (pathname === '/') {
        sendText(response, 404, 'The web app is not built, run npm run build or use npm run dev')
    } else {
        sendText(response, 404, 'Not found')
    }
}

function resolveStaticFile(requestedPath: string): string | undefined {
    const filePath = path.join(webDir, requestedPath)
    const isInsideWebDir = filePath.startsWith(webDir + path.sep)
    if (!isInsideWebDir) return undefined
    return fs.statSync(filePath, { throwIfNoEntry: false })?.isFile() ? filePath : undefined
}

function sendMethodNotAllowed(response: ServerResponse, allow: string): void {
    response.writeHead(405, { Allow: allow }).end()
}

function sendServerError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
        response.destroy()
        return
    }
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    send(response, status, 'application/json; charset=utf-8', JSON.stringify(body))
}

function sendText(response: ServerResponse, status: number, body: string): void {
    send(response, status, 'text/plain; charset=utf-8', `${body}\n`)
}

function send(response: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
    response.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
    })
    response.end(body)
}
