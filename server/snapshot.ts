import fs from 'node:fs'
import path from 'node:path'
import type { Snapshot, TreeNode } from '../shared/schema.ts'

// The original Action defaults, matched by name at any depth
const excludedNames = new Set([
    'node_modules',
    'bower_components',
    'dist',
    'out',
    'build',
    'eject',
    '.next',
    '.netlify',
    '.yarn',
    '.git',
    '.vscode',
    'package-lock.json',
    'yarn.lock',
])

// The ext4 directory size the Action saw, which decides where folders sort among files
const directorySize = 4096

export function buildSnapshot(repoPath: string): Snapshot {
    return {
        root: readDirectory(repoPath, '', path.basename(repoPath)),
        generatedAt: new Date().toISOString(),
    }
}

function readDirectory(absolutePath: string, relativePath: string, label: string): TreeNode {
    const children: TreeNode[] = []
    for (const entry of readSortedEntries(absolutePath)) {
        const childAbsolutePath = path.join(absolutePath, entry.name)
        const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
            const directory = readDirectory(childAbsolutePath, childRelativePath, entry.name)
            if (directory.children?.length) children.push(directory)
        } else if (entry.isFile()) {
            children.push({
                id: `file:${childRelativePath}`,
                label: entry.name,
                path: childRelativePath,
                size: fs.statSync(childAbsolutePath).size,
            })
        }
    }
    return { id: `dir:${relativePath}`, label, path: relativePath, size: directorySize, children }
}

function readSortedEntries(directoryPath: string): fs.Dirent[] {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => !excludedNames.has(entry.name))
        .sort((a, b) => compareNames(a.name, b.name))
}

function compareNames(a: string, b: string): number {
    if (a < b) return -1
    if (a > b) return 1
    return 0
}
