import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { configDir, readJsonFile, writeJsonFile } from '../server/json-file.ts'

type ServerInfo = z.infer<typeof serverFileSchema>

const serverFileSchema = z.object({ pid: z.number().int().positive(), url: z.string() })
const answerTimeoutMs = 1000
const startTimeoutMs = 10_000
const pollMs = 200

export function serverLogPath(repoRoot: string): string {
    return path.join(repoRoot, configDir, 'server.log')
}

function serverFilePath(repoRoot: string): string {
    return path.join(repoRoot, configDir, 'server.json')
}

function readServerFile(repoRoot: string): ServerInfo | undefined {
    const result = readJsonFile(serverFilePath(repoRoot), serverFileSchema)
    return result.status === 'ok' ? result.value : undefined
}

export function recordServer(repoRoot: string, url: string): void {
    writeJsonFile(serverFilePath(repoRoot), { pid: process.pid, url })
    process.on('exit', () => {
        // A server started later for the same repo may own the file by now
        if (readServerFile(repoRoot)?.pid === process.pid) fs.rmSync(serverFilePath(repoRoot), { force: true })
    })
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit())
}

// The URL check keeps a stale file from naming a pid that the system has given to another process
async function findRunningServer(repoRoot: string): Promise<ServerInfo | undefined> {
    const server = readServerFile(repoRoot)
    return server && isAlive(server.pid) && await answers(server.url) ? server : undefined
}

export async function startBackgroundServer(repoRoot: string): Promise<string> {
    const running = await findRunningServer(repoRoot)
    if (running) return running.url
    fs.rmSync(serverFilePath(repoRoot), { force: true })
    fs.mkdirSync(path.join(repoRoot, configDir), { recursive: true })
    const log = fs.openSync(serverLogPath(repoRoot), 'a')
    // The exec arguments keep the tsx loader when the CLI runs from source
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], 'serve', repoRoot], {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
    })
    fs.closeSync(log)
    child.unref()
    const deadline = Date.now() + startTimeoutMs
    while (Date.now() < deadline && child.exitCode === null) {
        await delay(pollMs)
        const server = await findRunningServer(repoRoot)
        if (server) return server.url
    }
    throw new Error(`The Dev Bubbles server did not start, see ${serverLogPath(repoRoot)}`)
}

export async function stopBackgroundServer(repoRoot: string): Promise<string> {
    const recorded = readServerFile(repoRoot)
    const running = await findRunningServer(repoRoot)
    if (running) process.kill(running.pid)
    fs.rmSync(serverFilePath(repoRoot), { force: true })
    if (running) return `Stopped the Dev Bubbles server at ${running.url} (pid ${running.pid})`
    if (recorded) return `The Dev Bubbles server in ${configDir}/server.json was no longer running, removed the file`
    return 'No Dev Bubbles server is running for this repo'
}

export function openInBrowser(url: string): void {
    const [command, ...args] = process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : [process.platform === 'darwin' ? 'open' : 'xdg-open', url]
    spawn(command, args, { stdio: 'ignore', windowsHide: true })
        .on('error', () => console.error(`Could not open a browser, open ${url} by hand`))
        .unref()
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
    }
}

async function answers(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(answerTimeoutMs) })
        await response.body?.cancel()
        return true
    } catch {
        return false
    }
}
