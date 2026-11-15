import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CommitInfo } from '../shared/schema.ts'

const execFileAsync = promisify(execFile)
const gitMaxBuffer = 256 * 1024 * 1024
const commitLimit = 100
const commitFormat = '%H%x00%s%x00%an%x00%cI'

// Resolves no commits for a repo without any, or when git log fails
export async function listCommits(repoRoot: string): Promise<CommitInfo[]> {
    const output = await execFileAsync('git', ['log', '-z', `-n${commitLimit}`, `--format=${commitFormat}`, 'HEAD', '--'], {
        cwd: repoRoot,
    }).catch(() => undefined)
    const fields = output?.stdout.split('\0') ?? []
    const commits: CommitInfo[] = []
    for (let index = 0; index + 4 <= fields.length; index += 4) {
        const [sha, subject, author, date] = fields.slice(index, index + 4)
        commits.push({ sha, subject, author, date })
    }
    return commits
}

// Resolves the full sha, or undefined when the repo has no such commit
export async function resolveCommit(repoRoot: string, commit: string): Promise<string | undefined> {
    const output = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], {
        cwd: repoRoot,
    }).catch(() => undefined)
    return output?.stdout.trim() || undefined
}

// A private index keeps the user's index, working tree and refs untouched
export async function withCommitTree<T>(
    repoRoot: string,
    sha: string,
    use: (treeDir: string, paths: string[]) => Promise<T>,
): Promise<T> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-bubbles-commit-'))
    try {
        const treeDir = path.join(tempDir, 'tree')
        await fs.mkdir(treeDir)
        const options = { cwd: repoRoot, env: { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') }, maxBuffer: gitMaxBuffer }
        await execFileAsync('git', ['read-tree', sha], options)
        // Without the trailing slash git prepends the prefix to each file name instead of using it as a folder
        await execFileAsync('git', ['checkout-index', '--all', '--force', `--prefix=${treeDir.replaceAll('\\', '/')}/`], options)
        const { stdout } = await execFileAsync('git', ['ls-files', '-z'], options)
        return await use(treeDir, stdout.split('\0').filter(Boolean))
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10 })
    }
}
