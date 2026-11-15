import { describe, expect, it } from 'vitest'
import { dirId, fileId, ownFilesId, ROOT_ID } from '../../shared/schema.ts'
import type { FileRef, Pin, TreeNode } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import {
    absolutePosition,
    findOpenIds,
    fitCenteredLabel,
    fitLabel,
    forceContain,
    indexFiles,
    indexLineages,
    indexNodes,
    minLabelSize,
    openRadius,
    packTree,
    syncBubbles,
} from './layout.ts'
import type { BubbleState, LayoutNode, View } from './layout.ts'

const nameOf = (path: string): string => path.split('/').at(-1) ?? path

const files = (folder: string, count: number): FileRef[] => {
    return Array.from({ length: count }, (_, index) => ({ path: `${folder}/file${index}.ts`, loc: 20 + index * 35 }))
}

const leaf = (path: string, fileRefs: FileRef[]): TreeNode => {
    return { id: dirId(path), kind: 'dir', label: nameOf(path), path, files: fileRefs }
}

const ownFiles = (path: string, fileRefs: FileRef[]): TreeNode => {
    return { ...leaf(path, fileRefs), id: ownFilesId(dirId(path)) }
}

const dir = (path: string, children: TreeNode[]): TreeNode => {
    return { id: dirId(path), kind: 'dir', label: path ? nameOf(path) : 'repo', path, children }
}

const sampleTree = (...extraSrc: TreeNode[]): TreeNode => dir('', [
    ownFiles('', [{ path: 'README.md', loc: 40 }]),
    dir('src', [
        leaf('src/api', files('src/api', 4)),
        dir('src/lib', [leaf('src/lib/core', files('src/lib/core', 3))]),
        ownFiles('src', files('src', 2)),
        ...extraSrc,
    ]),
    leaf('web', files('web', 5)),
])

const cliLeaf = leaf('src/cli', files('src/cli', 2))

const libTree = (...names: string[]): LayoutNode => packTree(dir('', [
    dir('src', [
        dir('src/lib', names.map((name) => leaf(`src/lib/${name}`, files(`src/lib/${name}`, 2)))),
        ownFiles('src', files('src', 2)),
    ]),
]))

const syncedBubbles = (tree: LayoutNode): Map<string, BubbleState> => {
    const bubbles = new Map<string, BubbleState>()
    syncBubbles(bubbles, tree, {})
    return bubbles
}

const bubbleAt = (x: number, y: number, r: number, isGroup = false): BubbleState => {
    return { id: 'dir:a', pinId: 'dir:a', parentId: ROOT_ID, r, isGroup, x, y }
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
            dir('src', [dir('src/lib', [leaf('src/lib/core', files('src/lib/core', 2))]), ownFiles('src', files('src', 1))]),
            {
                id: 'auth',
                kind: 'component',
                label: 'Auth',
                children: [{ id: 'auth.session', kind: 'component', label: 'Session', files: files('src/auth', 1) }],
            },
        ])))

        expect(nodes.get(dirId('src/lib/core'))).toMatchObject({ label: 'lib/core', pinId: dirId('src/lib') })
        expect(nodes.has(dirId('src/lib'))).toBe(false)
        expect(nodes.get('auth')?.children?.map((child) => child.id)).toEqual(['auth.session'])
    })

    it('sizes a leaf by the lines of its files, each counting at least one', () => {
        const nodes = indexNodes(packTree(dir('', [
            leaf('empty', [{ path: 'empty/a.ts', loc: 0 }]),
            leaf('one', [{ path: 'one/a.ts', loc: 1 }]),
            leaf('big', [{ path: 'big/a.ts', loc: 100 }]),
            leaf('split', [{ path: 'split/a.ts', loc: 60 }, { path: 'split/b.ts', loc: 40 }]),
            leaf('blank', [{ path: 'blank/a.ts', loc: 0 }, { path: 'blank/b.ts', loc: 0 }]),
        ])))
        const radiusOf = (path: string) => nodes.get(dirId(path))?.r ?? 0

        expect(radiusOf('empty')).toBeGreaterThan(0)
        expect(radiusOf('empty')).toBeCloseTo(radiusOf('one'))
        expect(radiusOf('big')).toBeCloseTo(radiusOf('one') * 10)
        expect(radiusOf('split')).toBeCloseTo(radiusOf('big'))
        expect(radiusOf('blank')).toBeCloseTo(radiusOf('one') * Math.SQRT2)
    })

    it('totals the files and lines under every node', () => {
        const nodes = indexNodes(packTree(sampleTree()))

        expect(nodes.get(dirId('src/api'))).toMatchObject({ fileCount: 4, loc: 20 + 55 + 90 + 125 })
        expect(nodes.get(dirId('src'))).toMatchObject({ fileCount: 9, loc: 290 + 20 + 55 + 90 + 20 + 55 })
        expect(nodes.get(ROOT_ID)?.fileCount).toBe(15)
    })
})

describe('indexLineages', () => {
    it('indexes every file under the leaf that holds it', () => {
        const lineages = indexLineages(packTree(sampleTree()))

        expect(lineages.get(dirId('src/lib/core'))).toEqual([ROOT_ID, dirId('src'), dirId('src/lib/core')])
        expect(lineages.get(fileId('src/lib/core/file1.ts'))).toEqual([
            ROOT_ID,
            dirId('src'),
            dirId('src/lib/core'),
            fileId('src/lib/core/file1.ts'),
        ])
        expect(lineages.get(fileId('README.md'))).toEqual([ROOT_ID, ownFilesId(ROOT_ID), fileId('README.md')])
    })
})

describe('indexFiles', () => {
    it('finds the path, lines and leaf of every file', () => {
        const tree = packTree(sampleTree())
        const entries = indexFiles(tree)

        expect(entries.size).toBe(15)
        expect(entries.get(fileId('src/file1.ts'))).toMatchObject({ path: 'src/file1.ts', loc: 55 })
        expect(entries.get(fileId('src/file1.ts'))?.leaf).toBe(indexNodes(tree).get(ownFilesId(dirId('src'))))
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

        const grown = packTree(sampleTree(cliLeaf))
        const changedGroups = syncBubbles(bubbles, grown, {})
        const srcRadius = indexNodes(grown).get(dirId('src'))!.r

        expect(bubbles.get(dirId('web'))).toMatchObject({ x: 123, y: -45 })
        expect(distanceFromCentre(bubbles.get(dirId('src/cli'))!)).toBeLessThan(srcRadius * 0.2)
        expect(changedGroups.has(dirId('src'))).toBe(true)
    })

    it('reheats the group around a leaf whose files grew', () => {
        const bubbles = syncedBubbles(packTree(sampleTree()))
        const [rootFiles, src] = sampleTree().children ?? []
        const grown = packTree(dir('', [rootFiles, src, leaf('web', files('web', 6))]))

        expect(syncBubbles(bubbles, grown, {})).toEqual(new Set([ROOT_ID]))
    })

    it('gives a group with no surviving members its packed layout', () => {
        const bubbles = syncedBubbles(packTree(sampleTree()))
        const regrouped = packTree(dir('', [
            ...sampleTree().children ?? [],
            {
                id: 'docs',
                kind: 'component',
                label: 'Docs',
                children: [
                    { id: 'docs.guides', kind: 'component', label: 'Guides', files: files('docs/guides', 3) },
                    { id: 'docs.api', kind: 'component', label: 'API', files: files('docs/api', 2) },
                ],
            },
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
        const bubbles = syncedBubbles(packTree(sampleTree(cliLeaf)))
        const changedGroups = syncBubbles(bubbles, packTree(sampleTree()), {})

        expect(bubbles.has(dirId('src/cli'))).toBe(false)
        expect(changedGroups.has(dirId('src'))).toBe(true)
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
        const bubbles = syncedBubbles(libTree('core'))
        Object.assign(bubbles.get(dirId('src/lib/core'))!, { x: 30, y: 5 })

        syncBubbles(bubbles, libTree('core', 'extra'), {})
        expect(bubbles.get(dirId('src/lib'))).toMatchObject({ parentId: dirId('src'), x: 30, y: 5 })
        Object.assign(bubbles.get(dirId('src/lib'))!, { x: -20, y: 10 })

        syncBubbles(bubbles, libTree('core'), {})
        expect(bubbles.get(dirId('src/lib/core'))).toMatchObject({ parentId: dirId('src'), x: -20, y: 10 })
    })

    it('keys the pin of a collapsed chain by its outermost directory', () => {
        const pins: Record<string, Pin> = { [dirId('src/lib')]: [12, -8] }
        const bubbles = new Map<string, BubbleState>()

        syncBubbles(bubbles, libTree('core'), pins)
        expect(bubbles.get(dirId('src/lib/core'))).toMatchObject({ pinId: dirId('src/lib'), fx: 12, fy: -8 })

        syncBubbles(bubbles, libTree('core', 'extra'), pins)
        expect(bubbles.get(dirId('src/lib'))).toMatchObject({ parentId: dirId('src'), fx: 12, fy: -8 })
        const inner = bubbles.get(dirId('src/lib/core'))
        expect(inner).toMatchObject({ pinId: dirId('src/lib/core'), parentId: dirId('src/lib') })
        expect(inner?.fx ?? null).toBeNull()
    })

    it('applies pins to nodes that are new on load', () => {
        const bubbles = new Map<string, BubbleState>()
        syncBubbles(bubbles, packTree(sampleTree()), { [dirId('web')]: [-3, 4] })

        expect(bubbles.get(dirId('web'))).toMatchObject({ x: -3, y: 4, fx: -3, fy: 4 })
    })
})

describe('absolutePosition', () => {
    it('adds the parent-local offsets up to the root and caches each ancestor', () => {
        const bubbles = new Map<string, BubbleState>([
            [ROOT_ID, { ...bubbleAt(0, 0, 100), id: ROOT_ID, parentId: '' }],
            [dirId('a'), { ...bubbleAt(10, 5, 30), id: dirId('a'), parentId: ROOT_ID }],
            [dirId('a/b'), { ...bubbleAt(-3, 4, 5), id: dirId('a/b'), parentId: dirId('a') }],
        ])
        const cache = new Map<string, Point>()

        expect(absolutePosition(bubbles, dirId('a/b'), cache)).toEqual([7, 9])
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
    const node = (id: string, r: number): LayoutNode => {
        return { id, pinId: id, kind: 'dir', label: id, fileCount: 1, loc: 1, depth: 0, r, x: 0, y: 0 }
    }
    const group = (id: string, r: number, children: LayoutNode[]): LayoutNode => ({ ...node(id, r), children })
    const root = group(ROOT_ID, 100, [group('dir:a', 30, [group('dir:a/b', 10, [node('dir:a/b/c', 2)])])])
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

describe('fitCenteredLabel', () => {
    it('keeps the label at least minLabelSize pixels on screen and truncates it to fit', () => {
        expect(fitCenteredLabel('Server', 100, 1)).toEqual({ text: 'Server', fontSize: 30 })
        expect(fitCenteredLabel('Server', 100, 0.2)).toEqual({ text: 'Serv…', fontSize: minLabelSize / 0.2 })
    })

    it('drops the label when the bubble cannot hold a few characters on screen', () => {
        expect(fitCenteredLabel('Server', 100, 0.1)).toBeUndefined()
        expect(fitCenteredLabel('UI', 100, 0.1)).toEqual({ text: 'UI', fontSize: minLabelSize / 0.1 })
    })
})
