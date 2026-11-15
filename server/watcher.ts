import path from 'node:path'
import { watch } from 'chokidar'

export type RepoWatcher = {
    close(): Promise<void>
}

const ignoredSegments = new Set(['.git', 'node_modules', 'dist', 'build', '.next'])
const debounceMs = 300

// A file written nonstop, such as a dev server log, still lets a rescan through
const maxWaitMs = 600

// Resolves once the initial crawl is done, so changes made right after are not missed
export function watchRepo(repoRoot: string, gitIndexPath: string, onChange: () => void): Promise<RepoWatcher> {
    let timer: NodeJS.Timeout | undefined
    let burstStart: number | undefined
    const watcher = watch([repoRoot, path.dirname(gitIndexPath)], {
        ignoreInitial: true,
        ignored: (filePath) => isIgnoredPath(repoRoot, gitIndexPath, path.resolve(filePath)),
    })
    watcher.on('all', () => {
        burstStart ??= Date.now()
        clearTimeout(timer)
        const wait = Math.min(debounceMs, burstStart + maxWaitMs - Date.now())
        timer = setTimeout(() => {
            burstStart = undefined
            onChange()
        }, Math.max(0, wait))
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

// git add and git rm change the file set through the git index alone
function isIgnoredPath(repoRoot: string, gitIndexPath: string, filePath: string): boolean {
    if (filePath === gitIndexPath || filePath === path.dirname(gitIndexPath)) return false
    const segments = path.relative(repoRoot, filePath).split(path.sep)
    return segments[0] === '..' || segments.some((segment) => ignoredSegments.has(segment))
}
