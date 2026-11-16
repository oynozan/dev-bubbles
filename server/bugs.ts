import { fileId } from '../shared/schema.ts'
import type { Bug, BugsFile, Mark, SnapshotBug, SnapshotMark } from '../shared/schema.ts'

export function resolveBugs(
    bugsFile: BugsFile | undefined,
    nodeIds: ReadonlySet<string>,
): { bugs: SnapshotBug[], errors: string[] } {
    const errors: string[] = []
    const bugs: SnapshotBug[] = []
    for (const [index, bug] of (bugsFile?.bugs ?? []).entries()) {
        if (bug.status === 'open') bugs.push(resolveBug(bug, `bugs[${index}]`, nodeIds, errors))
    }
    return { bugs, errors }
}

function resolveBug(bug: Bug, jsonPath: string, nodeIds: ReadonlySet<string>, errors: string[]): SnapshotBug {
    const marks: SnapshotMark[] = []
    for (const [index, mark] of bug.marks.entries()) {
        const nodeId = markNodeId(mark)
        if (nodeIds.has(nodeId)) marks.push({ nodeId, state: mark.state, reason: mark.reason })
        else errors.push(`bugs.json: ${jsonPath}.marks[${index}].${describeUnknownTarget(mark)}`)
    }
    return { id: bug.id, title: bug.title, updatedAt: bug.updatedAt, marks }
}

export function markNodeId(mark: Mark): string {
    return 'component' in mark ? mark.component : fileId(mark.file)
}

function describeUnknownTarget(mark: Mark): string {
    return 'component' in mark ? `component: unknown component ${mark.component}` : `file: unknown file ${mark.file}`
}
