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
    return path.relative(repoRoot, filePath).split(path.sep).some((segment) => ignoredSegments.has(segment))
}
