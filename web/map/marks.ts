import { packEnclose } from 'd3'
import { ROOT_ID } from '../../shared/schema.ts'
import type { MarkState, SnapshotBug } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import type { Circle } from './edges.ts'
import { absolutePosition, findVisibleId } from './layout.ts'
import type { BubbleState, Lineages } from './layout.ts'

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

// Confirmed wins when several open bugs mark one node
export const markNodes = (bugs: readonly SnapshotBug[], selectedBugId: string | undefined): Map<string, NodeMark> => {
    const marks = new Map<string, NodeMark>()
    for (const bug of bugs) {
        const isDimmed = selectedBugId !== undefined && bug.id !== selectedBugId
        for (const { nodeId, state } of bug.marks) {
            const previous = marks.get(nodeId)
            marks.set(nodeId, {
                state: previous?.state === 'confirmed' ? 'confirmed' : state,
                isDimmed: (previous?.isDimmed ?? true) && isDimmed,
            })
        }
    }
    return marks
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
    if (!rollUp || (rollUp.isDimmed && !mark.isDimmed)) return { ...mark, count: 1 }
    if (mark.isDimmed && !rollUp.isDimmed) return rollUp
    const state = rollUp.state === 'confirmed' ? 'confirmed' : mark.state
    return { state, isDimmed: rollUp.isDimmed, count: rollUp.count + 1 }
}

// The smallest circle around the marked bubbles, focused on the deepest node that holds them all
export const fitMarks = (
    ids: readonly string[],
    bubbles: ReadonlyMap<string, BubbleState>,
    lineages: Lineages,
): MarkFit | undefined => {
    const positions = new Map<string, Point>()
    const knownIds = ids.filter((id) => bubbles.has(id) && lineages.has(id))
    const circles = knownIds.map((id): Circle => {
        const [x, y] = absolutePosition(bubbles, id, positions)
        return { x, y, r: bubbles.get(id)?.r ?? 0 }
    })
    if (!circles.length) return undefined
    const { x, y, r } = packEnclose(circles)
    return { circle: { x, y, r }, focusId: findCommonAncestor(knownIds, lineages) }
}

const findCommonAncestor = (ids: readonly string[], lineages: Lineages): string => {
    const [first = [], ...rest] = ids.map((id) => lineages.get(id) ?? [])
    // Ids are unique in the tree, so the depths where all lineages agree form a prefix
    const shared = first.filter((id, depth) => rest.every((lineage) => lineage[depth] === id))
    return shared.at(-1) ?? ROOT_ID
}
