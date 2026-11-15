import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import micromatch from 'micromatch'
import { configDir } from './json-file.ts'

export type InventoryFile = {
    path: string
    loc: number
    mtimeMs: number
    size: number
}

type InspectedFile = {
    mtimeMs: number
    size: number
    // Undefined for binaries, LFS pointers and files over the size limit, which stay off the map
    loc: number | undefined
}

const execFileAsync = promisify(execFile)
const gitMaxBuffer = 256 * 1024 * 1024
const maxFileSize = 1024 * 1024
const binaryProbeSize = 8 * 1024
// A past commit is checked out with LFS pointers, which stand for files the live view drops as binary
const lfsPointerStart = Buffer.from('version https://git-lfs.github.com/spec/v1')
const newlineByte = 10
const batchSize = 64

export async function findRepoRoot(dir: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dir })
        return path.resolve(stdout.trim())
    } catch (error) {
        throw new Error(`Not inside a git repository: ${dir}`, { cause: error })
    }
}

// A worktree or submodule keeps its git files outside the repo root
export async function findGitPath(repoRoot: string, gitPath: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', gitPath], { cwd: repoRoot })
    return path.resolve(repoRoot, stdout.trim())
}

export function createInventory(
    rootDir: string,
    listPaths: () => Promise<string[]>,
): { scan(ignore: string[]): Promise<InventoryFile[]> } {
    let cache = new Map<string, InspectedFile>()

    async function inspectFile(filePath: string): Promise<InspectedFile | undefined> {
        const absolutePath = path.join(rootDir, filePath)
        const stats = await fs.stat(absolutePath).catch(() => undefined)
        if (!stats?.isFile()) return undefined
        const cached = cache.get(filePath)
        if (cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached
        const { mtimeMs, size } = stats
        if (size > maxFileSize) return { mtimeMs, size, loc: undefined }
        const content = await fs.readFile(absolutePath).catch(() => undefined)
        if (!content) return undefined
        return { mtimeMs, size, loc: isBinary(content) || isLfsPointer(content) ? undefined : countLines(content) }
    }

    return {
        async scan(ignore: string[]): Promise<InventoryFile[]> {
            const paths = (await listPaths())
                .filter((filePath) => !filePath.startsWith(`${configDir}/`))
            const visiblePaths = (ignore.length > 0 ? micromatch.not(paths, ignore, { dot: true }) : paths)
                .sort(compareStrings)
            const inspected = await mapInBatches(visiblePaths, inspectFile)
            cache = new Map()
            const files: InventoryFile[] = []
            for (const [index, filePath] of visiblePaths.entries()) {
                const file = inspected[index]
                if (!file) continue
                cache.set(filePath, file)
                if (file.loc !== undefined) files.push({ ...file, path: filePath, loc: file.loc })
            }
            return files
        },
    }
}

export async function listRepoFiles(repoRoot: string, trackedOnly: boolean): Promise<string[]> {
    const args = trackedOnly
        ? ['ls-files', '--cached', '-z']
        : ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, maxBuffer: gitMaxBuffer })
    return [...new Set(stdout.split('\0').filter(Boolean))]
}

function isBinary(content: Buffer): boolean {
    return content.subarray(0, binaryProbeSize).includes(0)
}

function isLfsPointer(content: Buffer): boolean {
    return content.subarray(0, lfsPointerStart.length).equals(lfsPointerStart)
}

function countLines(content: Buffer): number {
    let lines = 0
    for (let index = content.indexOf(newlineByte); index !== -1; index = content.indexOf(newlineByte, index + 1)) {
        lines++
    }
    const hasUnterminatedLine = content.length > 0 && content[content.length - 1] !== newlineByte
    return hasUnterminatedLine ? lines + 1 : lines
}

// Bounded so a large repo does not run out of file handles
async function mapInBatches<T, R>(items: T[], map: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = []
    for (let start = 0; start < items.length; start += batchSize) {
        results.push(...await Promise.all(items.slice(start, start + batchSize).map(map)))
    }
    return results
}

export function compareStrings(a: string, b: string): number {
    if (a < b) return -1
    if (a > b) return 1
    return 0
}
