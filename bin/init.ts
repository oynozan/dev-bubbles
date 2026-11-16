import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { configDir, formatJson } from '../server/json-file.ts'
import { findPackageRoot } from '../server/package-root.ts'
import { cliCommand, cliPath } from './repo.ts'

type Settings = z.infer<typeof settingsSchema>

const blockStart = '<!-- dev-bubbles:start -->'
const blockEnd = '<!-- dev-bubbles:end -->'
const hookEvents = { SessionStart: 'session', UserPromptSubmit: 'prompt', Stop: 'stop' }
const localFiles = ['dev-bubbles/', 'bugs.json', 'layout.json', 'server.json', 'server.log']
const settingsPath = path.join('.claude', 'settings.json')

// Loose, so every key and hook the user has comes back out unchanged
const settingsSchema = z.looseObject({
    hooks: z.record(z.string(), z.array(z.looseObject({ hooks: z.array(z.looseObject({})) }))).optional(),
})

export function init(repoRoot: string): void {
    const packageRoot = findPackageRoot(import.meta.dirname)
    const cli = cliCommand(repoRoot)
    const fillCli = (text: string) => text.replaceAll('{{cli}}', cli)
    console.log(`Setting up Dev Bubbles in ${repoRoot}`)
    createFileOnce(repoRoot, path.join(configDir, 'components.json'), formatJson({ version: 1, components: [] }))
    createFileOnce(repoRoot, path.join(configDir, 'bugs.json'), formatJson({ version: 1, bugs: [] }))
    addToGitignore(repoRoot, localFiles.map((name) => `${configDir}/${name}`))
    copyTemplates(path.join(packageRoot, 'templates', 'commands'), repoRoot, path.join('.claude', 'commands'), fillCli)
    copyTemplates(path.join(packageRoot, 'skills', 'dev-bubbles'), repoRoot, path.join('.claude', 'skills', 'dev-bubbles'))
    const snippet = fillCli(fs.readFileSync(path.join(packageRoot, 'templates', 'claude-snippet.md'), 'utf8'))
    updateFile(repoRoot, 'CLAUDE.md', (current) => withClaudeSection(current, snippet))
    updateFile(repoRoot, settingsPath, (current) => withHooks(repoRoot, current))
    console.log([
        '',
        'Next steps:',
        `  1. ${cli} up --open`,
        '  2. Ask the agent to map the repo (or /map)',
    ].join('\n'))
}

function createFileOnce(repoRoot: string, relativePath: string, content: string): void {
    const filePath = path.join(repoRoot, relativePath)
    if (fs.existsSync(filePath)) {
        console.log(`  skipped ${relativePath}, it already exists`)
        return
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    console.log(`  created ${relativePath}`)
}

// The update returns undefined to leave the file as it is
function updateFile(repoRoot: string, relativePath: string, update: (current: string | undefined) => string | undefined): void {
    const filePath = path.join(repoRoot, relativePath)
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined
    const next = update(current)
    if (next === undefined) return
    if (next === current) {
        console.log(`  ${relativePath} is up to date`)
        return
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, next)
    console.log(`  ${current === undefined ? 'created' : 'updated'} ${relativePath}`)
}

function addToGitignore(repoRoot: string, entries: string[]): void {
    const gitignorePath = path.join(repoRoot, '.gitignore')
    const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
    const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()))
    const missing = entries.filter((entry) => !lines.has(entry))
    if (missing.length === 0) return
    const eol = current.includes('\r\n') ? '\r\n' : '\n'
    const separator = current === '' || current.endsWith('\n') ? '' : eol
    fs.appendFileSync(gitignorePath, separator + missing.map((entry) => entry + eol).join(''))
    console.log(`  added ${missing.join(', ')} to .gitignore`)
}

// Refreshed on every run so an update reaches them, unless a file of the same name is the user's own
function copyTemplates(sourceDir: string, repoRoot: string, targetDir: string, fill = (text: string) => text): void {
    const sourceFiles = fs.readdirSync(sourceDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(sourceDir, path.join(entry.parentPath, entry.name)))
    for (const sourceFile of sourceFiles) {
        const targetPath = path.join(targetDir, sourceFile)
        updateFile(repoRoot, targetPath, (current) => {
            if (current === undefined || current.includes('Dev Bubbles')) return fill(fs.readFileSync(path.join(sourceDir, sourceFile), 'utf8'))
            console.log(`  skipped ${targetPath}, it is not a Dev Bubbles file`)
            return undefined
        })
    }
}

function withClaudeSection(current: string | undefined, snippet: string): string {
    const eol = current?.includes('\r\n') ? '\r\n' : '\n'
    const block = [blockStart, snippet.replaceAll('\r\n', '\n').trim(), blockEnd].join('\n').replaceAll('\n', eol)
    if (current === undefined || current === '') return block + eol
    const end = current.indexOf(blockEnd)
    const start = end === -1 ? -1 : current.lastIndexOf(blockStart, end)
    if (start !== -1) return current.slice(0, start) + block + current.slice(end + blockEnd.length)
    return current + (current.endsWith('\n') ? eol : eol + eol) + block + eol
}

function withHooks(repoRoot: string, current: string | undefined): string | undefined {
    const settings = parseSettings(current)
    if (!settings) {
        console.log(`  warning: ${settingsPath} is not valid JSON, left it untouched, add the Dev Bubbles hooks by hand`)
        return undefined
    }
    const hooks = { ...settings.hooks }
    for (const [event, name] of Object.entries(hookEvents)) {
        const ownCommands = [`cli.js" hook ${name}`, `cli.js hook ${name}`]
        const isDevBubbles = ({ command }: Record<string, unknown>) => (
            typeof command === 'string' && ownCommands.some((part) => command.includes(part))
        )
        const groups = (hooks[event] ?? []).flatMap((group) => {
            const kept = group.hooks.filter((hook) => !isDevBubbles(hook))
            return kept.length === 0 && group.hooks.length > 0 ? [] : [{ ...group, hooks: kept }]
        })
        hooks[event] = [...groups, { hooks: [{ type: 'command', command: hookCommand(repoRoot, name) }] }]
    }
    return formatJson({ ...settings, hooks })
}

function parseSettings(text: string | undefined): Settings | undefined {
    if (text === undefined) return {}
    try {
        return settingsSchema.parse(JSON.parse(text.replace(/^﻿/, '')))
    } catch {
        return undefined
    }
}

function hookCommand(repoRoot: string, name: string): string {
    const cli = cliPath(repoRoot)
    return `node "${path.isAbsolute(cli) ? cli : `$CLAUDE_PROJECT_DIR/${cli}`}" hook ${name}`
}
