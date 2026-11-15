import { describe, expect, it } from 'vitest'
import { dirId, fileId, ownFilesId, ROOT_ID, UNMAPPED_ID } from '../../shared/schema.ts'
import type { Edge, TreeNode } from '../../shared/schema.ts'
import { aggregateEdges, describeHttpEdge, edgeCurve, edgeWidth, indexConnections, isEdgeOf } from './edges.ts'
import type { VisibleEdge } from './edges.ts'
import { indexLineages, packTree } from './layout.ts'
import type { Circle } from './layout.ts'

const fileRefs = (paths: string[]) => paths.map((path) => ({ path, loc: 30 }))

const dirLeaf = (path: string, paths: string[]): TreeNode => {
    return { id: dirId(path), kind: 'dir', label: path.split('/').at(-1) ?? path, path, files: fileRefs(paths) }
}

const dir = (path: string, children: TreeNode[]): TreeNode => {
    return { id: dirId(path), kind: 'dir', label: path.split('/').at(-1) ?? path, path, children }
}

const leaf = (id: string, paths: string[]): TreeNode => ({ id, kind: 'component', label: id, files: fileRefs(paths) })

const component = (id: string, children: TreeNode[]): TreeNode => ({ id, kind: 'component', label: id, children })

const ownApi = ownFilesId('api')

const lineages = indexLineages(packTree({
    id: ROOT_ID,
    kind: 'dir',
    label: 'repo',
    path: '',
    children: [
        leaf('web', ['web/app.tsx', 'web/client.ts']),
        component('api', [leaf('api.billing', ['api/billing.ts', 'api/invoice.ts']), leaf(ownApi, ['api/server.ts'])]),
        leaf(UNMAPPED_ID, ['src/main.ts']),
    ],
}))

// Before the agent maps the repo, the bubbles are directories
const dirLineages = indexLineages(packTree(dir('', [
    dir('src', [
        dir('src/lib', [dirLeaf('src/lib/core', ['src/lib/core/a.ts', 'src/lib/core/b.ts'])]),
        dirLeaf('src/util', ['src/util/x.ts']),
        { ...dirLeaf('src', ['src/main.ts']), id: ownFilesId(dirId('src')) },
    ]),
    dirLeaf('docs', ['docs/guide.md']),
])))

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
        expect(ends(aggregateEdges([appToServer], lineages, open('api')))).toEqual([['import', 'web', ownApi]])
    })

    it('aggregates again as a group opens and closes', () => {
        const toBilling = importEdge('web/client.ts', 'api/billing.ts')

        expect(ends(aggregateEdges([toBilling], lineages, open('api')))).toEqual([['import', 'web', 'api.billing']])
        expect(ends(aggregateEdges([toBilling], lineages, open()))).toEqual([['import', 'web', 'api']])
    })

    it('drops edges whose ends meet in one drawn bubble or nest inside each other', () => {
        const insideWeb = importEdge('web/app.tsx', 'web/client.ts')
        const insideApi = importEdge('api/billing.ts', 'api/server.ts')
        const toOwnChild = httpEdge('api', 'api.billing')

        expect(aggregateEdges([insideWeb, insideApi, toOwnChild], lineages, open())).toEqual([])
        expect(aggregateEdges([insideWeb, toOwnChild], lineages, open('api'))).toEqual([])
        expect(ends(aggregateEdges([insideApi], lineages, open('api')))).toEqual([['import', 'api.billing', ownApi]])
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
        const coreToDocs = importEdge('src/lib/core/b.ts', 'docs/guide.md')

        expect(ends(aggregateEdges([coreToUtil, coreToDocs], dirLineages, open()))).toEqual([['import', dirId('src'), dirId('docs')]])
        expect(ends(aggregateEdges([coreToUtil, coreToDocs], dirLineages, open(dirId('src'))))).toEqual([
            ['import', dirId('src/lib/core'), dirId('src/util')],
            ['import', dirId('src/lib/core'), dirId('docs')],
        ])
    })

    it('draws manual component edges on the component or the closed group around it', () => {
        const manual = httpEdge('web', 'api.billing', 'calls BILLING_URL')

        expect(ends(aggregateEdges([manual], lineages, open()))).toEqual([['http', 'web', 'api']])
        expect(aggregateEdges([manual], lineages, open('api'))).toMatchObject([
            { from: 'web', to: 'api.billing', labels: ['calls BILLING_URL'] },
        ])
    })

    it('skips ends that are not in the tree', () => {
        expect(aggregateEdges([importEdge('gone.ts', 'web/app.tsx')], lineages, open())).toEqual([])
    })
})

describe('isEdgeOf', () => {
    it('picks edges that end on a bubble or inside it', () => {
        const edge = visibleEdge('web', 'api.billing')

        expect(isEdgeOf(edge, 'web', lineages)).toBe(true)
        expect(isEdgeOf(edge, 'api', lineages)).toBe(true)
        expect(isEdgeOf(edge, 'api.billing', lineages)).toBe(true)
        expect(isEdgeOf(edge, ownApi, lineages)).toBe(false)
        expect(isEdgeOf(edge, UNMAPPED_ID, lineages)).toBe(false)
    })
})

describe('edgeCurve', () => {
    const source: Circle = { x: 0, y: 0, r: 10 }
    const target: Circle = { x: 100, y: 0, r: 20 }
    const distanceTo = (circle: Circle, [x, y]: [number, number]) => Math.hypot(x - circle.x, y - circle.y)

    it('starts on the source border and ends on the target border', () => {
        const { start, end } = edgeCurve(source, target, 'import')

        expect(distanceTo(source, start)).toBeCloseTo(source.r)
        expect(distanceTo(target, end)).toBeCloseTo(target.r)
    })

    it('bends slightly to opposite sides for the two directions of a pair', () => {
        const there = edgeCurve(source, target, 'import').control
        const back = edgeCurve(target, source, 'import').control

        expect(Math.abs(there[1])).toBeGreaterThan(0)
        expect(Math.abs(there[1])).toBeLessThan((100 - 30) / 4)
        expect(Math.sign(there[1])).toBe(-Math.sign(back[1]))
    })

    it('keeps the control point outside both circles', () => {
        const big: Circle = { x: 0, y: 0, r: 100 }
        const small: Circle = { x: 110, y: 0, r: 5 }
        const { control } = edgeCurve(big, small, 'import')

        expect(distanceTo(big, control)).toBeGreaterThan(big.r)
        expect(distanceTo(small, control)).toBeGreaterThan(small.r)
    })

    it('draws an import and an HTTP call between the same pair as two arcs', () => {
        const importBend = edgeCurve(source, target, 'import').control[1]
        const httpBend = edgeCurve(source, target, 'http').control[1]

        expect(Math.sign(httpBend)).toBe(Math.sign(importBend))
        expect(Math.abs(httpBend)).toBeGreaterThan(Math.abs(importBend) * 2)
    })
})

describe('edgeWidth', () => {
    it('grows with the log of the count up to a cap', () => {
        expect(edgeWidth(1)).toBe(1)
        expect(edgeWidth(4)).toBe(2)
        expect(edgeWidth(1e6)).toBe(4)
    })
})

describe('describeHttpEdge', () => {
    it('lists the routes and caps the list', () => {
        const routes = Array.from({ length: 13 }, (_, index) => `GET /api/r${index}`)

        expect(describeHttpEdge(visibleEdge('web', 'api', routes.slice(0, 2)))).toBe('HTTP calls\nGET /api/r0\nGET /api/r1')
        expect(describeHttpEdge(visibleEdge('web', 'api', routes)).split('\n').slice(-2)).toEqual(['GET /api/r9', 'and 3 more'])
    })
})

describe('indexConnections', () => {
    it('lists every edge at both of its ends by kind and direction', () => {
        const index = indexConnections([
            importEdge('web/app.tsx', 'web/client.ts'),
            importEdge('api/server.ts', 'web/client.ts'),
            httpEdge(fileId('web/client.ts'), fileId('api/billing.ts'), 'GET /api/invoices'),
            httpEdge('web', 'api.billing', 'calls BILLING_URL'),
        ])

        expect(index.get(fileId('web/client.ts'))).toEqual({
            imports: [],
            importedBy: [{ id: fileId('web/app.tsx') }, { id: fileId('api/server.ts') }],
            calls: [{ id: fileId('api/billing.ts'), label: 'GET /api/invoices' }],
            calledBy: [],
        })
        expect(index.get(fileId('web/app.tsx'))?.imports).toEqual([{ id: fileId('web/client.ts') }])
        expect(index.get(fileId('api/billing.ts'))?.calledBy).toEqual([{ id: fileId('web/client.ts'), label: 'GET /api/invoices' }])
        expect(index.get('api.billing')?.calledBy).toEqual([{ id: 'web', label: 'calls BILLING_URL' }])
        expect(index.has(fileId('api/invoice.ts'))).toBe(false)
    })
})
