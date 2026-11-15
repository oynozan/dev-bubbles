import path from 'node:path'
import { watch } from 'chokidar'

export type RepoWatcher = {
    close(): Promise<void>
}

const ignoredSegments = new Set(['.git', 'node_modules', 'dist', 'build', '.next'])
const debounceMs = 300

// Resolves once the initial crawl is done, so changes made right after are not missed
export function watchRepo(repoRoot: string, onChange: () => void): Promise<RepoWatcher> {
    let timer: NodeJS.Timeout | undefined
    const watcher = watch(repoRoot, {
        ignoreInitial: true,
        ignored: (filePath) => isIgnoredPath(repoRoot, filePath),
    })
    watcher.on('all', () => {
        clearTimeout(timer)
        timer = setTimeout(onChange, debounceMs)
    })
    watcher.on('error', (error) => {
        console.error(`Watcher error: ${error instanceof Error ? error.message : String(error)}`)
    })
    const close = async () => {
        clearTimeout(timer)
        await watcher.close()
    }
    return new Promise((resolve) => {
        watcher.once('ready', () => resolve({ close }))
    })
}

function isIgnoredPath(repoRoot: string, filePath: string): boolean {
    const segments = path.relative(repoRoot, filePath).split(path.sep)
    return !isGitIndexPath(segments) && segments.some((segment) => ignoredSegments.has(segment))
}

// git add and git rm change the file set through .git/index alone
function isGitIndexPath(segments: string[]): boolean {
    return segments[0] === '.git' && (segments.length === 1 || (segments.length === 2 && segments[1] === 'index'))
}
