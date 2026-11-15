import { fileId } from '../shared/schema.ts'
import type { Bug, BugsFile, Mark, SnapshotBug, SnapshotMark, TreeNode } from '../shared/schema.ts'
import { flattenTree } from './components.ts'

export function resolveBugs(bugsFile: BugsFile | undefined, root: TreeNode): { bugs: SnapshotBug[], errors: string[] } {
    const nodeIds = new Set(flattenTree(root).map((node) => node.id))
    const errors: string[] = []
    const bugs = (bugsFile?.bugs ?? [])
        .filter((bug) => bug.status === 'open')
        .map((bug) => resolveBug(bug, nodeIds, errors))
    return { bugs, errors }
}

function resolveBug(bug: Bug, nodeIds: Set<string>, errors: string[]): SnapshotBug {
    const marks: SnapshotMark[] = []
    for (const mark of bug.marks) {
        const nodeId = 'component' in mark ? mark.component : fileId(mark.file)
        if (nodeIds.has(nodeId)) marks.push({ nodeId, state: mark.state, reason: mark.reason })
        else errors.push(`bugs.json: bug ${bug.id}: unknown ${describeTarget(mark)}`)
    }
    return { id: bug.id, title: bug.title, updatedAt: bug.updatedAt, marks }
}

function describeTarget(mark: Mark): string {
    return 'component' in mark ? `component ${mark.component}` : `file ${mark.file}`
}
