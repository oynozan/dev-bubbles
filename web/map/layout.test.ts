import { describe, expect, it } from 'vitest'
import { dirId, fileId, ROOT_ID } from '../../shared/schema.ts'
import type { Pin, TreeNode } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import {
    absolutePosition,
    findOpenIds,
    fitLabel,
    forceContain,
    indexNodes,
    openRadius,
    packTree,
    syncBubbles,
} from './layout.ts'
import type { BubbleState, LayoutNode, View } from './layout.ts'

const nameOf = (path: string): string => path.split('/').at(-1) ?? path

const file = (path: string, loc: number): TreeNode => {
    return { id: fileId(path), kind: 'file', label: nameOf(path), path, loc }
}

const dir = (path: string, children: TreeNode[]): TreeNode => {
    return { id: dirId(path), kind: 'dir', label: path ? nameOf(path) : 'repo', path, children }
}

const files = (folder: string, count: number): TreeNode[] => {
    return Array.from({ length: count }, (_, index) => file(`${folder}/file${index}.ts`, 20 + index * 35))
}

const sampleTree = (extraApiFiles = 0): TreeNode => dir('', [
    file('README.md', 40),
    dir('src', [
        dir('src/api', files('src/api', 4 + extraApiFiles)),
        dir('src/lib', [dir('src/lib/core', files('src/lib/core', 3))]),
        ...files('src', 2),
    ]),
    dir('web', files('web', 5)),
])

const utilTree = (...names: string[]): LayoutNode => packTree(dir('', [
    dir('src', [dir('src/util', names.map((name) => file(`src/util/${name}`, 40))), ...files('src', 2)]),
]))

const syncedBubbles = (tree: LayoutNode): Map<string, BubbleState> => {
    const bubbles = new Map<string, BubbleState>()
    syncBubbles(bubbles, tree, {})
    return bubbles
}

const bubbleAt = (x: number, y: number, r: number, isGroup = false): BubbleState => {
    return { id: 'file:a.ts', pinId: 'file:a.ts', parentId: ROOT_ID, r, isGroup, x, y }
}

const distanceFromCentre = ({ x, y }: { x: number, y: number }): number => Math.hypot(x, y)

describe('packTree', () => {
    it('gives parent-local positions that keep every child inside its parent', () => {
        const visit = (node: LayoutNode): void => {
            for (const child of node.children ?? []) {
                expect(distanceFromCentre(child) + child.r).toBeLessThanOrEqual(node.r + 1e-9)
                visit(child)
            }
        }
        const root = packTree(sampleTree())

        expect(root.x).toBe(0)
        expect(root.y).toBe(0)
        visit(root)
    })

    it('collapses single-child directory chains but never components', () => {
        const nodes = indexNodes(packTree(dir('', [
            dir('src', [dir('src/lib', [dir('src/lib/core', files('src/lib/core', 2))]), file('src/main.ts', 9)]),
            { id: 'auth', kind: 'component', label: 'Auth', children: [file('src/auth/session.ts', 30)] },
        ])))

        expect(nodes.get(dirId('src/lib/core'))).toMatchObject({ label: 'lib/core', pinId: dirId('src/lib') })
        expect(nodes.has(dirId('src/lib'))).toBe(false)
        expect(nodes.get('auth')?.children?.map((child) => child.id)).toEqual([fileId('src/auth/session.ts')])
    })

    it('sizes files by lines with a minimum of one', () => {
        const nodes = indexNodes(packTree(dir('', [file('empty.ts', 0), file('one.ts', 1), file('big.ts', 100)])))
        const radiusOf = (path: string) => nodes.get(fileId(path))?.r ?? 0

        expect(radiusOf('empty.ts')).toBeGreaterThan(0)
        expect(radiusOf('empty.ts')).toBeCloseTo(radiusOf('one.ts'))
        expect(radiusOf('big.ts')).toBeCloseTo(radiusOf('one.ts') * 10)
    })
})

describe('syncBubbles', () => {
    it('starts every node at its packed position without reheating', () => {
        const tree = packTree(sampleTree())
        const bubbles = new Map<string, BubbleState>()

        expect(syncBubbles(bubbles, tree, {})).toEqual(new Set())
        for (const node of indexNodes(tree).values()) {
            expect(bubbles.get(node.id)).toMatchObject({ x: node.x, y: node.y, r: node.r })
        }
    })

    it('keeps surviving positions and places new nodes near their parent centre', () => {
        const bubbles = syncedBubbles(packTree(sampleTree()))
        const web = bubbles.get(dirId('web'))!
        web.x = 123
        web.y = -45

        const grown = packTree(sampleTree(1))
        const changedGroups = syncBubbles(bubbles, grown, {})
        const newFile = bubbles.get(fileId('src/api/file4.ts'))!
        const apiRadius = indexNodes(grown).get(dirId('src/api'))!.r

        expect(bubbles.get(dirId('web'))).toMatchObject({ x: 123, y: -45 })
        expect(distanceFromCentre(newFile)).toBeLessThan(apiRadius * 0.2)
        expect(changedGroups).toEqual(new Set([dirId('src/api'), dirId('src'), ROOT_ID]))
    })

    it('gives a group with no surviving members its packed layout', () => {
        const bubbles = syncedBubbles(packTree(sampleTree()))
        const regrouped = packTree(dir('', [
            ...sampleTree().children ?? [],
            { id: 'docs', kind: 'component', label: 'Docs', children: files('docs', 3) },
        ]))
        const changedGroups = syncBubbles(bubbles, regrouped, {})
        const docs = indexNodes(regrouped).get('docs')!

        for (const child of docs.children ?? []) {
            expect(bubbles.get(child.id)).toMatchObject({ x: child.x, y: child.y })
        }
        expect(distanceFromCentre(bubbles.get('docs')!)).toBeLessThan(regrouped.r * 0.2)
        expect(changedGroups.has('docs')).toBe(false)
    })

    it('drops nodes that left the tree and reheats their group', () => {
        const bubbles = syncedBubbles(packTree(sampleTree(1)))
        const changedGroups = syncBubbles(bubbles, packTree(sampleTree()), {})

        expect(bubbles.has(fileId('src/api/file4.ts'))).toBe(false)
        expect(changedGroups.has(dirId('src/api'))).toBe(true)
        expect(changedGroups.has(dirId('web'))).toBe(false)
    })

    it('lets pins override positions and releases nodes whose pin is gone', () => {
        const tree = packTree(sampleTree())
        const bubbles = syncedBubbles(tree)

        const changedGroups = syncBubbles(bubbles, tree, { [dirId('web')]: [10, 20] })
        expect(bubbles.get(dirId('web'))).toMatchObject({ x: 10, y: 20, fx: 10, fy: 20 })
        expect(changedGroups).toEqual(new Set([ROOT_ID]))

        syncBubbles(bubbles, tree, {})
        expect(bubbles.get(dirId('web'))).toMatchObject({ x: 10, y: 20, fx: null, fy: null })
    })

    it('leaves a clamped pin alone until the saved pin changes', () => {
        const tree = packTree(sampleTree())
        const bubbles = syncedBubbles(tree)
        const pins: Record<string, Pin> = { [dirId('web')]: [500, 0] }
        syncBubbles(bubbles, tree, pins)
        const web = bubbles.get(dirId('web'))!
        web.x = 17
        web.fx = 17

        expect(syncBubbles(bubbles, tree, pins)).toEqual(new Set())
        expect(web).toMatchObject({ x: 17, fx: 17 })
        syncBubbles(bubbles, tree, { [dirId('web')]: [20, 0] })
        expect(web).toMatchObject({ x: 20, fx: 20 })
    })

    it('keeps the spot of a directory chain that expands or collapses', () => {
        const bubbles = syncedBubbles(utilTree('x.ts'))
        Object.assign(bubbles.get(fileId('src/util/x.ts'))!, { x: 30, y: 5 })

        syncBubbles(bubbles, utilTree('x.ts', 'y.ts'), {})
        expect(bubbles.get(dirId('src/util'))).toMatchObject({ parentId: dirId('src'), x: 30, y: 5 })
        Object.assign(bubbles.get(dirId('src/util'))!, { x: -20, y: 10 })

        syncBubbles(bubbles, utilTree('x.ts'), {})
        expect(bubbles.get(fileId('src/util/x.ts'))).toMatchObject({ parentId: dirId('src'), x: -20, y: 10 })
    })

    it('keys the pin of a collapsed chain by its outermost directory', () => {
        const pins: Record<string, Pin> = { [dirId('src/util')]: [12, -8] }
        const bubbles = new Map<string, BubbleState>()

        syncBubbles(bubbles, utilTree('x.ts'), pins)
        expect(bubbles.get(fileId('src/util/x.ts'))).toMatchObject({ pinId: dirId('src/util'), fx: 12, fy: -8 })

        syncBubbles(bubbles, utilTree('x.ts', 'y.ts'), pins)
        expect(bubbles.get(dirId('src/util'))).toMatchObject({ parentId: dirId('src'), fx: 12, fy: -8 })
        const inner = bubbles.get(fileId('src/util/x.ts'))
        expect(inner).toMatchObject({ pinId: fileId('src/util/x.ts'), parentId: dirId('src/util') })
        expect(inner?.fx ?? null).toBeNull()
    })

    it('applies pins to nodes that are new on load', () => {
        const bubbles = new Map<string, BubbleState>()
        syncBubbles(bubbles, packTree(sampleTree()), { [fileId('web/file0.ts')]: [-3, 4] })

        expect(bubbles.get(fileId('web/file0.ts'))).toMatchObject({ x: -3, y: 4, fx: -3, fy: 4 })
    })
})

describe('absolutePosition', () => {
    it('adds the parent-local offsets up to the root and caches each ancestor', () => {
        const bubbles = new Map<string, BubbleState>([
            [ROOT_ID, { ...bubbleAt(0, 0, 100), id: ROOT_ID, parentId: '' }],
            [dirId('a'), { ...bubbleAt(10, 5, 30), id: dirId('a'), parentId: ROOT_ID }],
            [fileId('a/b.ts'), { ...bubbleAt(-3, 4, 5), id: fileId('a/b.ts'), parentId: dirId('a') }],
        ])
        const cache = new Map<string, Point>()

        expect(absolutePosition(bubbles, fileId('a/b.ts'), cache)).toEqual([7, 9])
        expect(cache.get(dirId('a'))).toEqual([10, 5])
    })
})

describe('forceContain', () => {
    it('pulls an outside node back inside its parent and stops it moving outward', () => {
        const bubble = { ...bubbleAt(100, 0, 10), vx: 5, vy: 2 }
        const force = forceContain(() => 50)
        force.initialize?.([bubble], Math.random)
        force(1)

        expect(distanceFromCentre(bubble) + bubble.r).toBeLessThanOrEqual(50)
        expect(bubble.vx).toBeCloseTo(0)
        expect(bubble.vy).toBe(2)
    })

    it('clamps a pin that ends up outside a shrunken parent', () => {
        const bubble = { ...bubbleAt(0, 80, 10), fx: 0, fy: 80 }
        const force = forceContain(() => 50)
        force.initialize?.([bubble], Math.random)
        force(1)

        expect(bubble.fx).toBeCloseTo(0)
        expect((bubble.fy ?? 0) + bubble.r).toBeLessThanOrEqual(50)
    })

    it('leaves an inside node alone', () => {
        const bubble = bubbleAt(5, -5, 10)
        const force = forceContain(() => 50)
        force.initialize?.([bubble], Math.random)
        force(1)

        expect(bubble).toMatchObject({ x: 5, y: -5 })
    })
})

describe('findOpenIds', () => {
    const group = (id: string, r: number, children: LayoutNode[]): LayoutNode => {
        return { id, pinId: id, kind: 'dir', label: id, depth: 0, r, x: 0, y: 0, children }
    }
    const leaf = (id: string, r: number): LayoutNode => ({ id, pinId: id, kind: 'file', label: id, depth: 0, r, x: 0, y: 0 })
    const root = group(ROOT_ID, 100, [group('dir:a', 30, [group('dir:a/b', 10, [leaf('file:a/b/c.ts', 2)])])])
    const positions = new Map([[ROOT_ID, { x: 0, y: 0 }], ['dir:a', { x: 0, y: 0 }], ['dir:a/b', { x: 0, y: 0 }]])
    const viewAtScale = (k: number): View => ({ k, x: 500, y: 500, width: 1000, height: 1000 })

    it('opens a group only once its on-screen radius passes the threshold', () => {
        expect(findOpenIds(root, positions, viewAtScale((openRadius + 1) / 30))).toEqual(new Set([ROOT_ID, 'dir:a']))
        expect(findOpenIds(root, positions, viewAtScale((openRadius - 1) / 30))).toEqual(new Set([ROOT_ID]))
        expect(findOpenIds(root, positions, viewAtScale((openRadius + 1) / 10))).toEqual(
            new Set([ROOT_ID, 'dir:a', 'dir:a/b']),
        )
    })

    it('always opens the root', () => {
        expect(findOpenIds(root, positions, viewAtScale(0.01))).toEqual(new Set([ROOT_ID]))
    })

    it('keeps groups outside the viewport closed', () => {
        const offscreen = { ...viewAtScale(10), x: -5000 }

        expect(findOpenIds(root, positions, offscreen)).toEqual(new Set([ROOT_ID]))
    })
})

describe('fitLabel', () => {
    it('shrinks a long label before it truncates it with an ellipsis', () => {
        expect(fitLabel('session.ts', 100, 20)).toEqual({ text: 'session.ts', fontSize: 100 / 6 })
        const longLabel = fitLabel('a-really-long-component-label', 60, 20)

        expect(longLabel.fontSize).toBe(10)
        expect(longLabel.text).toBe('a-really-…')
    })
})
