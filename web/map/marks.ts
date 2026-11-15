import { packEnclose } from 'd3'
import { ROOT_ID } from '../../shared/schema.ts'
import type { MarkState, SnapshotBug, SnapshotMark } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import { absoluteCircle, findVisibleId } from './layout.ts'
import type { BubbleState, Circle, Lineages } from './layout.ts'

export type NodeMark = {
    state: MarkState
    // Marked only by bugs other than the selected one
    isDimmed: boolean
}

export type HiddenMarks = NodeMark & {
    count: number
}

export type MarkFit = {
    circle: Circle
    focusId: string
}

export const markNodes = (bugs: readonly SnapshotBug[], selectedBugId: string | undefined): Map<string, NodeMark> => {
    const marks = new Map<string, NodeMark>()
    for (const bug of bugs) {
        const isDimmed = selectedBugId !== undefined && bug.id !== selectedBugId
        for (const { nodeId, state } of bug.marks) marks.set(nodeId, mergeMark(marks.get(nodeId), { state, isDimmed }))
    }
    return marks
}

export const indexMarks = (bugs: readonly SnapshotBug[]): Map<string, SnapshotMark[]> => {
    const index = new Map<string, SnapshotMark[]>()
    for (const mark of bugs.flatMap((bug) => bug.marks)) index.set(mark.nodeId, [...index.get(mark.nodeId) ?? [], mark])
    return index
}

// The selected bug's marks win over dimmed ones, and among equals confirmed wins
const mergeMark = (previous: NodeMark | undefined, mark: NodeMark): NodeMark => {
    if (!previous || (previous.isDimmed && !mark.isDimmed)) return mark
    if (mark.isDimmed && !previous.isDimmed) return previous
    return { state: previous.state === 'confirmed' ? 'confirmed' : mark.state, isDimmed: mark.isDimmed }
}

// A mark inside a closed group shows on the drawn group, which counts the selected bug's marks ahead of dimmed ones
export const rollUpHiddenMarks = (
    marks: ReadonlyMap<string, NodeMark>,
    lineages: Lineages,
    openIds: ReadonlySet<string>,
): Map<string, HiddenMarks> => {
    const rollUps = new Map<string, HiddenMarks>()
    for (const [id, mark] of marks) {
        const lineage = lineages.get(id)
        if (!lineage) continue
        const visibleId = findVisibleId(lineage, openIds)
        if (visibleId !== id) rollUps.set(visibleId, addHiddenMark(rollUps.get(visibleId), mark))
    }
    return rollUps
}

const addHiddenMark = (rollUp: HiddenMarks | undefined, mark: NodeMark): HiddenMarks => {
    const { state, isDimmed } = mergeMark(rollUp, mark)
    const count = (rollUp?.isDimmed === isDimmed ? rollUp.count : 0) + (mark.isDimmed === isDimmed ? 1 : 0)
    return { state, isDimmed, count }
}

// The smallest circle around the marked bubbles, focused on the deepest node that holds them all
export const fitMarks = (
    ids: readonly string[],
    bubbles: ReadonlyMap<string, BubbleState>,
    lineages: Lineages,
): MarkFit | undefined => {
    const positions = new Map<string, Point>()
    // A file has no bubble of its own, so its mark fits the leaf that holds it
    const bubbleIds = ids.flatMap((id) => lineages.get(id)?.findLast((lineageId) => bubbles.has(lineageId)) ?? [])
    const circles = bubbleIds.map((id) => absoluteCircle(bubbles, id, positions))
    if (!circles.length) return undefined
    const { x, y, r } = packEnclose(circles)
    return { circle: { x, y, r }, focusId: findCommonAncestor(bubbleIds, lineages) }
}

const findCommonAncestor = (ids: readonly string[], lineages: Lineages): string => {
    const [first = [], ...rest] = ids.map((id) => lineages.get(id) ?? [])
    // Ids are unique in the tree, so the depths where all lineages agree form a prefix
    const shared = first.filter((id, depth) => rest.every((lineage) => lineage[depth] === id))
    return shared.at(-1) ?? ROOT_ID
}
