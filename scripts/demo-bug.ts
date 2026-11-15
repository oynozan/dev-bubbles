import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import micromatch from 'micromatch'
import { configDir, formatJson, readJsonFile } from '../server/json-file.ts'
import { bugsFileSchema, manifestSchema } from '../shared/schema.ts'
import type { Bug, ComponentDef, Mark } from '../shared/schema.ts'

const stepMs = 4000
const title = 'Demo: a saved setting is gone after a reload'
const reasons = ['the symptom shows up here', 'passes the setting along', 'stores the setting']
// Only code files make a believable culprit, a README or lockfile does not
const sourcePattern = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|py|go|rs|java|kt|rb|php|cs|swift)$/

function fail(message: string): never {
    console.error(message)
    process.exit(1)
}

function gitRoot(dir: string): string {
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
    } catch {
        fail(`${dir} is not inside a git repository`)
    }
}

function leavesOf(defs: ComponentDef[]): ComponentDef[] {
    return defs.flatMap((def) => def.children?.length ? leavesOf(def.children) : [def])
}

function readBugs(): Bug[] {
    const result = readJsonFile(bugsPath, bugsFileSchema)
    if (result.status === 'invalid') fail([...result.errors, 'Fix bugs.json before running the demo'].join('\n'))
    return result.status === 'ok' ? result.value.bugs : []
}

// Rereads the file on every step so bugs edited meanwhile by someone else survive
function saveDemoBug(bug?: Bug): void {
    const others = readBugs().filter(({ id }) => id !== demoId)
    const bugsFile = bugsFileSchema.parse({ version: 1, bugs: bug ? [...others, bug] : others })
    const tempPath = `${bugsPath}.${process.pid}.tmp`
    fs.writeFileSync(tempPath, formatJson(bugsFile))
    fs.renameSync(tempPath, bugsPath)
}

const repoRoot = gitRoot(path.resolve(process.argv[2] ?? process.env.DEV_BUBBLES_REPO ?? process.cwd()))
const bugsPath = path.join(repoRoot, configDir, 'bugs.json')
const manifestResult = readJsonFile(path.join(repoRoot, configDir, 'components.json'), manifestSchema)
if (manifestResult.status === 'missing') fail(`No ${configDir}/components.json in ${repoRoot}, map the repo with /map first`)
if (manifestResult.status === 'invalid') fail(manifestResult.errors.join('\n'))
const manifest = manifestResult.value

const repoFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0').filter((file) => sourcePattern.test(file))
const filesOf = (leaf: ComponentDef) => micromatch(repoFiles, leaf.include, {
    dot: true,
    ignore: [...(leaf.exclude ?? []), ...(manifest.ignore ?? [])],
})
const suspects = leavesOf(manifest.components)
    .map((leaf) => ({ leaf, files: filesOf(leaf) }))
    .filter(({ files }) => files.length > 0)
    .map((suspect) => ({ ...suspect, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, 3)
if (suspects.length === 0) fail('No component in components.json matches a source file')
const [culprit] = suspects
const file = culprit.files[Math.floor(Math.random() * culprit.files.length)]

const lastNumber = Math.max(0, ...readBugs().map(({ id }) => Number(/^b(\d+)$/.exec(id)?.[1] ?? 0)))
const demoId = `b${lastNumber + 1}`
const confirmed: Mark = { file, state: 'confirmed', reason: 'drops the setting before it is saved' }
const steps: [string, Bug['status'], Mark[]][] = [
    [`suspected ${suspects.map(({ leaf }) => leaf.label).join(', ')}`, 'open', suspects.map(({ leaf }, index) => (
        { component: leaf.id, state: 'suspected', reason: reasons[index] }
    ))],
    [`narrowed to ${culprit.leaf.label} and ${file}`, 'open', [
        { component: culprit.leaf.id, state: 'suspected', reason: 'the other suspects are ruled out' },
        { file, state: 'suspected', reason: 'writes the setting' },
    ]],
    [`confirmed ${file}`, 'open', [confirmed]],
    ['fixed, the marks clear', 'fixed', [confirmed]],
]

process.on('SIGINT', () => {
    saveDemoBug()
    process.exit(130)
})
console.log(`Writing demo bug ${demoId} to ${bugsPath}, watch the map`)
for (const [index, [message, status, marks]] of steps.entries()) {
    if (index > 0) await sleep(stepMs)
    saveDemoBug({ id: demoId, title, status, marks, updatedAt: new Date().toISOString() })
    console.log(`${index + 1}/${steps.length} ${message}`)
}
await sleep(stepMs)
saveDemoBug()
console.log(`Removed ${demoId}, other bugs are unchanged`)
