import path from 'node:path'
import { json } from 'node:stream/consumers'
import { findRepoRoot } from '../server/inventory.ts'
import { configDir, readJsonFile } from '../server/json-file.ts'
import { manifestSchema } from '../shared/schema.ts'
import { startBackgroundServer } from './background.ts'
import { cliCommand, findErrors } from './repo.ts'

type HookInput = {
    prompt?: unknown
    stop_hook_active?: unknown
}

const maxStopErrors = 20
// Word starts, so bug also catches bugs and buggy
const problemWords = [
    'bug', 'broken', 'breaks', 'not working', 'fail', 'error', 'crash', 'wrong', 'issue', 'problem',
    'weird', 'stuck', 'missing', 'freez', 'hang', 'undefined', 'exception', 'regression',
]
const problemPattern = new RegExp(String.raw`\b(${problemWords.join('|')}|(404|500|nan)\b|(doesn['’]?t|does not|isn['’]?t|is not|won['’]?t|can['’]?t|cannot)\s+(work|load|show|open|save|render|respond|connect|start|run))`, 'i')

// Claude Code runs this on every session start, prompt and turn end, so it never fails out loud
export async function runHook(event: string | undefined, dir: string): Promise<void> {
    const output = await hookOutput(event, dir).catch(() => undefined)
    if (output) console.log(output)
}

async function hookOutput(event: string | undefined, dir: string): Promise<string | undefined> {
    if (event === 'session') return describeSession(await findRepoRoot(dir))
    if (event === 'prompt') {
        const { prompt } = await readInput()
        return typeof prompt === 'string' && problemPattern.test(prompt) ? describeBugSteps(await findRepoRoot(dir)) : undefined
    }
    if (event === 'stop') {
        const { stop_hook_active: isActive } = await readInput()
        return isActive === true ? undefined : checkMap(await findRepoRoot(dir))
    }
    return undefined
}

async function readInput(): Promise<HookInput> {
    return await json(process.stdin) as HookInput
}

async function describeSession(repoRoot: string): Promise<string> {
    const url = await startBackgroundServer(repoRoot)
    const cli = cliCommand(repoRoot)
    const manifest = readJsonFile(path.join(repoRoot, configDir, 'components.json'), manifestSchema)
    const isUnmapped = manifest.status === 'missing' || (manifest.status === 'ok' && manifest.value.components.length === 0)
    return [
        `Dev Bubbles: the user is watching a live bubble map of this repo at ${url}.`,
        `Record every bug report at once, however casual ("this part doesn't work"), before investigating: \`${cli} bug open "<symptom>"\` prints an id, then \`${cli} bug mark <id> <component> suspected "<why>"\` for each likely component. Narrow the marks as you go, mark the root cause confirmed and run \`bug fix <id>\` after the fix. \`bug list\` shows the open bugs.`,
        `When you add files or features, add them to ${configDir}/components.json in the same turn and run \`${cli} validate\`.`,
        ...(isUnmapped ? ['This repo is not mapped yet. Offer to map it with the map procedure of the dev-bubbles skill, or /map.'] : []),
    ].join('\n')
}

function describeBugSteps(repoRoot: string): string {
    const cli = cliCommand(repoRoot)
    return [
        `Dev Bubbles: if this message reports a problem, record it on the bug map before investigating, the user watches it live. \`${cli} bug list\` shows the open bugs, reuse one instead of opening a duplicate.`,
        `1. \`${cli} bug open "<symptom in the user's words>"\` prints the bug id`,
        `2. \`${cli} bug mark <id> <component> suspected "<why>"\` for each likely component`,
        `3. Narrow the marks while investigating, \`${cli} bug clear <id> <target>\` drops a ruled-out suspect`,
        `4. \`${cli} bug mark <id> <component or file> confirmed "<root cause>"\` on the root cause`,
        `5. \`${cli} bug fix <id>\` after the fix`,
    ].join('\n')
}

// Line counts are read again on every turn, the import parse is skipped to stay fast
async function checkMap(repoRoot: string): Promise<string | undefined> {
    const errors = await findErrors(repoRoot, false)
    if (errors.length === 0) return undefined
    const listed = errors.slice(0, maxStopErrors).map((error) => `- ${error}`)
    if (errors.length > maxStopErrors) listed.push(`- ... and ${errors.length - maxStopErrors} more`)
    const reason = [
        'The Dev Bubbles map is out of date:',
        ...listed,
        `Update ${configDir}/components.json (a new component for a new feature, or extend a glob) and/or ${configDir}/bugs.json, then run \`${cliCommand(repoRoot)} validate\`.`,
    ].join('\n')
    return JSON.stringify({ decision: 'block', reason })
}
