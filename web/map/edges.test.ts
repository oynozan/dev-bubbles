import { describe, expect, it } from 'vitest'
import { dirId, fileId, ROOT_ID, UNMAPPED_ID } from '../../shared/schema.ts'
import type { Edge, TreeNode } from '../../shared/schema.ts'
import { aggregateEdges, describeHttpEdge, edgeCurve, edgeWidth, isEdgeOf } from './edges.ts'
import type { Circle, VisibleEdge } from './edges.ts'
import { indexLineages, packTree } from './layout.ts'

const file = (path: string): TreeNode => {
    return { id: fileId(path), kind: 'file', label: path.split('/').at(-1) ?? path, path, loc: 30 }
}

const dir = (path: string, children: TreeNode[]): TreeNode => {
    return { id: dirId(path), kind: 'dir', label: path.split('/').at(-1) ?? path, path, children }
}

const component = (id: string, children: TreeNode[]): TreeNode => ({ id, kind: 'component', label: id, children })

const lineages = indexLineages(packTree({
    id: ROOT_ID,
    kind: 'dir',
    label: 'repo',
    path: '',
    children: [
        component('web', [file('web/app.tsx'), file('web/client.ts')]),
        component('api', [component('api.billing', [file('api/billing.ts'), file('api/invoice.ts')]), file('api/server.ts')]),
        component(UNMAPPED_ID, [dir('src', [
            dir('src/lib', [dir('src/lib/core', [file('src/lib/core/a.ts'), file('src/lib/core/b.ts')])]),
            dir('src/util', [file('src/util/x.ts')]),
            file('src/main.ts'),
        ])]),
    ],
}))

const importEdge = (from: string, to: string): Edge => ({ from: fileId(from), to: fileId(to), kind: 'import' })

const httpEdge = (from: string, to: string, label?: string): Edge => {
    return label === undefined ? { from, to, kind: 'http' } : { from, to, kind: 'http', label }
}

const ends = (edges: VisibleEdge[]): string[][] => edges.map(({ from, to, kind }) => [kind, from, to])

const open = (...ids: string[]): Set<string> => new Set([ROOT_ID, ...ids])

const visibleEdge = (from: string, to: string, labels: string[] = []): VisibleEdge => {
    return { key: `${from} ${to}`, from, to, kind: 'http', count: labels.length || 1, labels }
}

describe('aggregateEdges', () => {
    const appToServer = importEdge('web/app.tsx', 'api/server.ts')

    it('moves both ends up to the deepest bubble drawn at the current zoom', () => {
        expect(ends(aggregateEdges([appToServer], lineages, open()))).toEqual([['import', 'web', 'api']])
        expect(ends(aggregateEdges([appToServer], lineages, open('web', 'api')))).toEqual([
            ['import', fileId('web/app.tsx'), fileId('api/server.ts')],
        ])
    })

    it('aggregates again as a group opens and closes', () => {
        const toBilling = importEdge('web/client.ts', 'api/billing.ts')

        expect(ends(aggregateEdges([toBilling], lineages, open('api')))).toEqual([['import', 'web', 'api.billing']])
        expect(ends(aggregateEdges([toBilling], lineages, open('api', 'api.billing')))).toEqual([
            ['import', 'web', fileId('api/billing.ts')],
        ])
        expect(ends(aggregateEdges([toBilling], lineages, open()))).toEqual([['import', 'web', 'api']])
    })

    it('drops edges whose ends meet in one drawn bubble or nest inside each other', () => {
        const insideWeb = importEdge('web/app.tsx', 'web/client.ts')
        const toOwnChild = httpEdge('api', 'api.billing')

        expect(aggregateEdges([insideWeb, toOwnChild], lineages, open())).toEqual([])
        expect(aggregateEdges([toOwnChild], lineages, open('api'))).toEqual([])
        expect(ends(aggregateEdges([insideWeb], lineages, open('web')))).toEqual([
            ['import', fileId('web/app.tsx'), fileId('web/client.ts')],
        ])
    })

    it('merges duplicates with a count and keeps kinds and directions apart', () => {
        const edges: Edge[] = [
            importEdge('web/app.tsx', 'api/server.ts'),
            importEdge('web/client.ts', 'api/billing.ts'),
            importEdge('api/server.ts', 'web/client.ts'),
            httpEdge(fileId('web/app.tsx'), fileId('api/billing.ts'), 'GET /api/invoices'),
            httpEdge(fileId('web/client.ts'), fileId('api/billing.ts'), 'GET /api/invoices'),
            httpEdge(fileId('web/client.ts'), fileId('api/invoice.ts'), 'POST /api/invoices'),
        ]

        expect(aggregateEdges(edges, lineages, open()).map(({ key, ...edge }) => edge)).toEqual([
            { from: 'web', to: 'api', kind: 'import', count: 2, labels: [] },
            { from: 'api', to: 'web', kind: 'import', count: 1, labels: [] },
            { from: 'web', to: 'api', kind: 'http', count: 3, labels: ['GET /api/invoices', 'POST /api/invoices'] },
        ])
    })

    it('ends on the ids of collapsed directory chains', () => {
        const coreToUtil = importEdge('src/lib/core/a.ts', 'src/util/x.ts')

        expect(ends(aggregateEdges([coreToUtil], lineages, open(UNMAPPED_ID, dirId('src'))))).toEqual([
            ['import', dirId('src/lib/core'), fileId('src/util/x.ts')],
        ])
        expect(ends(aggregateEdges([coreToUtil], lineages, open(UNMAPPED_ID, dirId('src'), dirId('src/lib/core'))))).toEqual([
            ['import', fileId('src/lib/core/a.ts'), fileId('src/util/x.ts')],
        ])
    })

    it('draws manual component edges on the component or the closed group around it', () => {
        const manual = httpEdge('web', 'api.billing', 'calls BILLING_URL')

        expect(ends(aggregateEdges([manual], lineages, open()))).toEqual([['http', 'web', 'api']])
        expect(ends(aggregateEdges([manual], lineages, open('web', 'api')))).toEqual([['http', 'web', 'api.billing']])
        expect(aggregateEdges([manual], lineages, open('web', 'api', 'api.billing'))).toMatchObject([
            { from: 'web', to: 'api.billing', labels: ['calls BILLING_URL'] },
        ])
    })

    it('skips ends that are not in the tree', () => {
        expect(aggregateEdges([importEdge('gone.ts', 'web/app.tsx')], lineages, open())).toEqual([])
    })
})

describe('isEdgeOf', () => {
    it('picks edges that end on a bubble or inside it', () => {
        const edge = visibleEdge(fileId('web/app.tsx'), 'api.billing')

        expect(isEdgeOf(edge, 'web', lineages)).toBe(true)
        expect(isEdgeOf(edge, 'api', lineages)).toBe(true)
        expect(isEdgeOf(edge, 'api.billing', lineages)).toBe(true)
        expect(isEdgeOf(edge, fileId('web/client.ts'), lineages)).toBe(false)
        expect(isEdgeOf(edge, fileId('api/billing.ts'), lineages)).toBe(false)
    })
})

describe('edgeCurve', () => {
    const source: Circle = { x: 0, y: 0, r: 10 }
    const target: Circle = { x: 100, y: 0, r: 20 }
    const distanceTo = (circle: Circle, [x, y]: [number, number]) => Math.hypot(x - circle.x, y - circle.y)

    it('starts on the source border and ends on the target border', () => {
        const { start, end } = edgeCurve(source, target)

        expect(distanceTo(source, start)).toBeCloseTo(source.r)
        expect(distanceTo(target, end)).toBeCloseTo(target.r)
    })

    it('bends slightly to opposite sides for the two directions of a pair', () => {
        const there = edgeCurve(source, target).control
        const back = edgeCurve(target, source).control

        expect(Math.abs(there[1])).toBeGreaterThan(0)
        expect(Math.abs(there[1])).toBeLessThan((100 - 30) / 4)
        expect(Math.sign(there[1])).toBe(-Math.sign(back[1]))
    })

    it('keeps the control point outside both circles', () => {
        const big: Circle = { x: 0, y: 0, r: 100 }
        const small: Circle = { x: 110, y: 0, r: 5 }
        const { control } = edgeCurve(big, small)

        expect(distanceTo(big, control)).toBeGreaterThan(big.r)
        expect(distanceTo(small, control)).toBeGreaterThan(small.r)
    })
})

describe('edgeWidth', () => {
    it('grows with the log of the count up to a cap', () => {
        expect(edgeWidth(1)).toBe(1)
        expect(edgeWidth(4)).toBe(3)
        expect(edgeWidth(1e6)).toBe(6)
    })
})

describe('describeHttpEdge', () => {
    it('lists the routes and caps the list', () => {
        const routes = Array.from({ length: 13 }, (_, index) => `GET /api/r${index}`)

        expect(describeHttpEdge(visibleEdge('web', 'api', routes.slice(0, 2)))).toBe('HTTP calls\nGET /api/r0\nGET /api/r1')
        expect(describeHttpEdge(visibleEdge('web', 'api', routes)).split('\n').slice(-2)).toEqual(['GET /api/r9', 'and 3 more'])
    })
})
