#!/usr/bin/env node
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { startServer } from '../server/index.ts'

const defaultPort = 4747

const usage = `Usage: dev-bubbles [serve] [options]

Options:
    --repo <path>  Repository to map (default: $DEV_BUBBLES_REPO or the current directory)
    --port <n>     Port to listen on, 0 picks a free one (default: ${defaultPort})
    --help         Show this help`

function fail(message: string): never {
    console.error(message)
    process.exit(1)
}

function readArgs() {
    try {
        return parseArgs({
            allowPositionals: true,
            options: {
                repo: { type: 'string' },
                port: { type: 'string', default: String(defaultPort) },
                help: { type: 'boolean', short: 'h' },
            },
        })
    } catch (error) {
        fail(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`)
    }
}

function parsePort(value: string): number {
    const port = Number(value)
    if (!/^\d+$/.test(value) || port > 65535) fail(`Invalid port: ${value}`)
    return port
}

function isAddressInUse(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}

const { values, positionals } = readArgs()

if (values.help) {
    console.log(usage)
    process.exit(0)
}

const [command = 'serve', ...extraArgs] = positionals
if (command !== 'serve' || extraArgs.length > 0) {
    fail(`Unknown command: ${positionals.join(' ')}\n\n${usage}`)
}

const repo = path.resolve(values.repo ?? process.env.DEV_BUBBLES_REPO ?? process.cwd())
if (!fs.statSync(repo, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Not a directory: ${repo}`)
}

const port = parsePort(values.port)

try {
    const server = await startServer({ repo, port })
    const { port: actualPort } = server.address() as AddressInfo
    console.log(`Dev Bubbles serving ${repo} at http://127.0.0.1:${actualPort}`)
} catch (error) {
    fail(isAddressInUse(error) ? `Port ${port} is already in use, pick another with --port <n>` : String(error))
}
