import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CommitInfo } from '../shared/schema.ts'

const execFileAsync = promisify(execFile)
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
