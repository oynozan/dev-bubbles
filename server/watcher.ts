import path from 'node:path'
import { watch } from 'chokidar'
import { errorMessage } from './json-file.ts'

export type RepoWatcher = {
    close(): Promise<void>
}

const ignoredSegments = new Set(['.git', 'node_modules', 'dist', 'build', '.next'])
const debounceMs = 300

// A file written nonstop, such as a dev server log, still lets a rescan through
const maxWaitMs = 600

// Resolves once the initial crawl is done, so changes made right after are not missed
export function watchRepo(repoRoot: string, gitFiles: string[], onChange: () => void): Promise<RepoWatcher> {
    let timer: NodeJS.Timeout | undefined
    let burstStart: number | undefined
    const watcher = watch([repoRoot, ...new Set(gitFiles.map((gitFile) => path.dirname(gitFile)))], {
        ignoreInitial: true,
        ignored: (filePath) => isIgnoredPath(repoRoot, gitFiles, path.resolve(filePath)),
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
        console.error(`Watcher error: ${errorMessage(error)}`)
    })
    const close = async () => {
        clearTimeout(timer)
        await watcher.close()
    }
    return new Promise((resolve) => {
        watcher.once('ready', () => resolve({ close }))
    })
}

// git add and git rm change the file set through the git index alone, and an amend or reset can move HEAD without it
function isIgnoredPath(repoRoot: string, gitFiles: string[], filePath: string): boolean {
    if (gitFiles.some((gitFile) => filePath === gitFile || filePath === path.dirname(gitFile))) return false
    const segments = path.relative(repoRoot, filePath).split(path.sep)
    return segments[0] === '..' || segments.some((segment) => ignoredSegments.has(segment))
}
