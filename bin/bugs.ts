import path from 'node:path'
import { markNodeId } from '../server/bugs.ts'
import { listComponents } from '../server/components.ts'
import { configDir, readJsonFile, writeJsonFile } from '../server/json-file.ts'
import { bugsFileSchema, fileId } from '../shared/schema.ts'
import type { Bug, BugsFile, Mark, MarkState } from '../shared/schema.ts'
import { loadRepo } from './repo.ts'

type Target = { component: string } | { file: string }

const closeIdCount = 5

export const bugUsage = `Bug commands, run in the repo or with --repo:
    bug open <title...>                                        Open a bug and print its id
    bug mark <id> <target> <suspected|confirmed> [reason...]   Mark a component id or a repo file path
    bug clear <id> <target>                                    Remove the mark on a target
    bug fix <id>                                               Set a bug to fixed, its marks leave the map
    bug list                                                   List the open bugs and their marks`

export async function runBugCommand(repoRoot: string, args: string[]): Promise<string> {
    const [action, ...rest] = args
    const filePath = path.join(repoRoot, configDir, 'bugs.json')
    const bugsFile = readBugsFile(filePath)
    const title = rest.join(' ').trim()
    if (action === 'list' && rest.length === 0) return describeOpenBugs(bugsFile.bugs)
    if (action === 'open' && title) {
        const id = nextBugId(bugsFile.bugs)
        saveBug(filePath, bugsFile, { id, title, status: 'open', marks: [] })
        return id
    }
    if (action === 'mark' && rest.length >= 3 && isMarkState(rest[2])) {
        const [id, target, state, ...reasonWords] = rest
        const bug = findBug(bugsFile, id)
        const reason = reasonWords.join(' ').trim()
        const mark: Mark = { ...await resolveTarget(repoRoot, target), state, ...(reason ? { reason } : {}) }
        const index = bug.marks.findIndex((existing) => markNodeId(existing) === markNodeId(mark))
        saveBug(filePath, bugsFile, { ...bug, marks: index === -1 ? [...bug.marks, mark] : bug.marks.with(index, mark) })
        return `Marked ${describeTarget(mark)} as ${state} on ${id}`
    }
    if (action === 'clear' && rest.length === 2) {
        const [id, target] = rest
        const bug = findBug(bugsFile, id)
        const targetIds = new Set([target, fileId(toRepoPath(repoRoot, target))])
        const marks = bug.marks.filter((mark) => !targetIds.has(markNodeId(mark)))
        if (marks.length === bug.marks.length) throw new Error(`${id} has no mark on ${target}`)
        saveBug(filePath, bugsFile, { ...bug, marks })
        return `Cleared the mark on ${target} from ${id}`
    }
    if (action === 'fix' && rest.length === 1) {
        const bug = findBug(bugsFile, rest[0])
        saveBug(filePath, bugsFile, { ...bug, status: 'fixed' })
        return `Fixed ${bug.id}, its marks leave the map`
    }
    throw new Error(bugUsage)
}

export function readBugsFile(filePath: string): BugsFile {
    const result = readJsonFile(filePath, bugsFileSchema)
    if (result.status === 'invalid') {
        throw new Error([...result.errors, `Fix ${configDir}/bugs.json first, it was left unchanged`].join('\n'))
    }
    return result.status === 'ok' ? result.value : { version: 1, bugs: [] }
}

export function writeBugsFile(filePath: string, bugsFile: BugsFile): void {
    writeJsonFile(filePath, bugsFileSchema.parse(bugsFile))
}

export function nextBugId(bugs: Bug[]): string {
    return `b${Math.max(0, ...bugs.map(({ id }) => Number(/^b(\d+)$/.exec(id)?.[1] ?? 0))) + 1}`
}

function saveBug(filePath: string, bugsFile: BugsFile, bug: Bug): void {
    const saved = { ...bug, updatedAt: new Date().toISOString() }
    const isNew = !bugsFile.bugs.some(({ id }) => id === bug.id)
    const bugs = isNew ? [...bugsFile.bugs, saved] : bugsFile.bugs.map((existing) => existing.id === bug.id ? saved : existing)
    writeBugsFile(filePath, { ...bugsFile, bugs })
}

function findBug(bugsFile: BugsFile, id: string): Bug {
    const bug = bugsFile.bugs.find((candidate) => candidate.id === id)
    if (!bug) throw new Error(`No bug ${id} in ${configDir}/bugs.json, bug list shows the open ones`)
    return bug
}

function isMarkState(value: string): value is MarkState {
    return value === 'suspected' || value === 'confirmed'
}

async function resolveTarget(repoRoot: string, target: string): Promise<Target> {
    const { manifestResult, manifest, files } = await loadRepo(repoRoot, false)
    const ids = listComponents(manifest?.components ?? []).map(({ def }) => def.id)
    if (ids.includes(target)) return { component: target }
    const file = toRepoPath(repoRoot, target)
    if (files.some((known) => known.path === file)) return { file }
    const hint = manifestResult.status === 'invalid'
        ? `${configDir}/components.json is invalid, run validate`
        : ids.length > 0 ? `Close component ids: ${closestIds(target, ids).join(', ')}` : `${configDir}/components.json has no components yet`
    throw new Error(`Unknown target ${target}, it is neither a component id in ${configDir}/components.json nor a file on the map. ${hint}`)
}

function toRepoPath(repoRoot: string, target: string): string {
    return path.relative(repoRoot, path.resolve(repoRoot, target.replaceAll('\\', '/'))).replaceAll('\\', '/')
}

function describeTarget(mark: Mark): string {
    return 'component' in mark ? mark.component : mark.file
}

function describeOpenBugs(bugs: Bug[]): string {
    const open = bugs.filter((bug) => bug.status === 'open')
    if (open.length === 0) return 'No open bugs'
    return open.flatMap((bug) => [
        `${bug.id} ${bug.title}`,
        ...bug.marks.map((mark) => `  ${mark.state} ${describeTarget(mark)}${mark.reason ? `: ${mark.reason}` : ''}`),
    ]).join('\n')
}

function closestIds(target: string, ids: string[]): string[] {
    const needle = target.toLowerCase()
    const distance = (id: string) => id.toLowerCase().includes(needle) ? 0 : editDistance(needle, id.toLowerCase())
    return ids
        .map((id) => ({ id, distance: distance(id) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, closeIdCount)
        .map(({ id }) => id)
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let i = 0; i < a.length; i++) {
        const current = [i + 1]
        for (let j = 0; j < b.length; j++) {
            current.push(Math.min(previous[j + 1] + 1, current[j] + 1, previous[j] + (a[i] === b[j] ? 0 : 1)))
        }
        previous = current
    }
    return previous[b.length]
}
