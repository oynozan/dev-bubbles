import { describe, expect, it } from 'vitest'
import { fileId, ROOT_ID } from '../../shared/schema.ts'
import type { MarkState, SnapshotBug, TreeNode } from '../../shared/schema.ts'
import type { Circle } from './edges.ts'
import { absolutePosition, indexLineages, packTree, syncBubbles } from './layout.ts'
import type { BubbleState } from './layout.ts'
import { fitMarks, markNodes, rollUpHiddenMarks } from './marks.ts'

const file = (path: string): TreeNode => {
    return { id: fileId(path), kind: 'file', label: path.split('/').at(-1) ?? path, path, loc: 30 }
}

const component = (id: string, children: TreeNode[]): TreeNode => ({ id, kind: 'component', label: id, children })

const tree = packTree({
    id: ROOT_ID,
    kind: 'dir',
    label: 'repo',
    path: '',
    children: [
        component('web', [file('web/app.tsx'), file('web/client.ts')]),
        component('api', [component('api.billing', [file('api/billing.ts'), file('api/invoice.ts')]), file('api/server.ts')]),
    ],
})

const lineages = indexLineages(tree)

const app = fileId('web/app.tsx')
const billing = fileId('api/billing.ts')
const invoice = fileId('api/invoice.ts')
const server = fileId('api/server.ts')

const bug = (id: string, marks: [string, MarkState][]): SnapshotBug => {
    return { id, title: id, marks: marks.map(([nodeId, state]) => ({ nodeId, state })) }
}

const open = (...ids: string[]): Set<string> => new Set([ROOT_ID, ...ids])

const syncedBubbles = (): Map<string, BubbleState> => {
    const bubbles = new Map<string, BubbleState>()
    syncBubbles(bubbles, tree, {})
    return bubbles
}

const circleOf = (bubbles: Map<string, BubbleState>, id: string): Circle => {
    const [x, y] = absolutePosition(bubbles, id)
    return { x, y, r: bubbles.get(id)?.r ?? 0 }
}

const encloses = (outer: Circle, inner: Circle): boolean => {
    return Math.hypot(inner.x - outer.x, inner.y - outer.y) + inner.r <= outer.r + 1e-6
}

describe('markNodes', () => {
    it('lets confirmed win over suspected whichever bug comes first', () => {
        const suspectedFirst = markNodes([bug('b1', [[billing, 'suspected']]), bug('b2', [[billing, 'confirmed']])], undefined)
        const confirmedFirst = markNodes([bug('b1', [[billing, 'confirmed']]), bug('b2', [[billing, 'suspected']])], undefined)

        expect(suspectedFirst.get(billing)?.state).toBe('confirmed')
        expect(confirmedFirst.get(billing)?.state).toBe('confirmed')
    })

    it('dims the nodes that only bugs other than the selected one mark', () => {
        const bugs = [bug('b1', [[app, 'suspected'], [billing, 'confirmed']]), bug('b2', [[billing, 'suspected'], [invoice, 'suspected']])]
        const dimmedIds = (selectedBugId: string | undefined): string[] => {
            return [...markNodes(bugs, selectedBugId)].filter(([, mark]) => mark.isDimmed).map(([id]) => id)
        }

        expect(dimmedIds(undefined)).toEqual([])
        expect(dimmedIds('b2')).toEqual([app])
        expect(dimmedIds('b1')).toEqual([invoice])
    })

    it('draws a node in the state the selected bug gave it, whatever the dimmed bugs say', () => {
        const bugs = [bug('b1', [[billing, 'confirmed']]), bug('b2', [[billing, 'suspected']])]

        expect(markNodes(bugs, 'b2').get(billing)).toEqual({ state: 'suspected', isDimmed: false })
        expect(markNodes(bugs, 'b1').get(billing)).toEqual({ state: 'confirmed', isDimmed: false })
    })
})

describe('rollUpHiddenMarks', () => {
    const marks = markNodes([bug('b1', [[app, 'suspected'], [billing, 'confirmed']]), bug('b2', [[invoice, 'suspected']])], undefined)

    it('counts hidden marks on the deepest closed ancestor drawn at the current zoom', () => {
        expect(rollUpHiddenMarks(marks, lineages, open())).toEqual(new Map([
            ['web', { state: 'suspected', isDimmed: false, count: 1 }],
            ['api', { state: 'confirmed', isDimmed: false, count: 2 }],
        ]))
        expect(rollUpHiddenMarks(marks, lineages, open('api'))).toEqual(new Map([
            ['web', { state: 'suspected', isDimmed: false, count: 1 }],
            ['api.billing', { state: 'confirmed', isDimmed: false, count: 2 }],
        ]))
    })

    it('leaves out marks drawn on their own bubble', () => {
        const groupMark = markNodes([bug('b1', [['api.billing', 'suspected']])], undefined)

        expect(rollUpHiddenMarks(marks, lineages, open('web', 'api', 'api.billing')).size).toBe(0)
        expect(rollUpHiddenMarks(groupMark, lineages, open('api')).size).toBe(0)
    })

    it('counts the selected bug ahead of the dimmed ones', () => {
        const bugs = [bug('b1', [[billing, 'confirmed'], [server, 'confirmed'], [app, 'confirmed']]), bug('b2', [[invoice, 'suspected']])]
        const selected = markNodes(bugs, 'b2')

        expect(rollUpHiddenMarks(selected, lineages, open())).toEqual(new Map([
            ['web', { state: 'confirmed', isDimmed: true, count: 1 }],
            ['api', { state: 'suspected', isDimmed: false, count: 1 }],
        ]))
        expect(rollUpHiddenMarks(markNodes(bugs, undefined), lineages, open()).get('api')).toEqual({
            state: 'confirmed',
            isDimmed: false,
            count: 3,
        })
    })
})

describe('fitMarks', () => {
    const bubbles = syncedBubbles()

    it('fits the smallest circle around every mark and focuses their deepest shared ancestor', () => {
        const fit = fitMarks([app, billing], bubbles, lineages)
        const from = circleOf(bubbles, app)
        const to = circleOf(bubbles, billing)

        expect(fit?.focusId).toBe(ROOT_ID)
        expect(fit && encloses(fit.circle, from) && encloses(fit.circle, to)).toBe(true)
        expect(fit?.circle.r).toBeCloseTo((Math.hypot(to.x - from.x, to.y - from.y) + from.r + to.r) / 2)
        expect(fitMarks([billing, invoice], bubbles, lineages)?.focusId).toBe('api.billing')
    })

    it('fits a single mark like a click on its bubble', () => {
        expect(fitMarks(['api.billing'], bubbles, lineages)).toEqual({
            circle: circleOf(bubbles, 'api.billing'),
            focusId: 'api.billing',
        })
    })

    it('skips marks on nodes it does not know', () => {
        expect(fitMarks(['gone'], bubbles, lineages)).toBeUndefined()
        expect(fitMarks(['gone', server], bubbles, lineages)?.focusId).toBe(server)
    })
})
