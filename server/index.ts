import fs from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import path from 'node:path'
import { buildSnapshot } from './snapshot.ts'

export type ServerOptions = {
    repo: string
    port: number
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

export function startServer({ repo, port }: ServerOptions): Promise<Server> {
    const server = createServer((request, response) => {
        try {
            handleRequest(repo, request, response)
        } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
    })
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject)
            resolve(server)
        })
    })
}

function handleRequest(repo: string, request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end()
        return
    }
    const pathname = readPathname(request.url ?? '/')
    if (pathname === undefined) {
        sendText(response, 400, 'Bad request')
        return
    }
    if (pathname === '/api/snapshot') {
        sendJson(response, 200, buildSnapshot(repo))
        return
    }
    serveStatic(pathname, response)
}

function readPathname(url: string): string | undefined {
    try {
        const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
        return pathname.includes('\0') ? undefined : pathname
    } catch {
        return undefined
    }
}

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

function findPackageRoot(startDir: string): string {
    let dir = startDir
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
        const parentDir = path.dirname(dir)
        if (parentDir === dir) throw new Error(`No package.json found above ${startDir}`)
        dir = parentDir
    }
    return dir
}
