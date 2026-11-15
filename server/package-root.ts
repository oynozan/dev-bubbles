import fs from 'node:fs'
import path from 'node:path'

export function findPackageRoot(startDir: string): string {
    let dir = startDir
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
        const parentDir = path.dirname(dir)
        if (parentDir === dir) throw new Error(`No package.json found above ${startDir}`)
        dir = parentDir
    }
    return dir
}
