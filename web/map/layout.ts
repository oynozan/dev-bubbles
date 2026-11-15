/*
 * Static circle pack layout, ported from repo-visualizer.
 * The tree is processed into sized and colored data, packed with d3, then every
 * sibling group is reflowed by a force simulation that keeps circles inside their parent.
 */
import { forceCollide, forceSimulation, forceX, forceY, hierarchy, pack, scaleSqrt } from 'd3'
import type { HierarchyCircularNode, SimulationNodeDatum } from 'd3'
import type { TreeNode } from '../../shared/schema.ts'
import languageColors from '../lib/language-colors.json'
import { keepBetween, keepCircleInsideCircle } from '../lib/utils.ts'
import type { Point } from '../lib/utils.ts'

export type BubbleDatum = {
    id: string
    path: string
    label: string
    extension: string
    value: number
    sortOrder: number
    color: string
    children?: BubbleDatum[]
}

export type PositionedNode = {
    data: BubbleDatum
    depth: number
    x: number
    y: number
    r: number
    children?: PositionedNode[]
}

type ReflowItem = PositionedNode & SimulationNodeDatum & {
    originalX: number
    originalY: number
}

export const width = 1000
export const height = 1000
export const maxDepth = 9
export const looseFilesId = '__structure_loose_file__'
export const fileColors = new Map<string, string>(Object.entries(languageColors))

const maxChildren = 9000
const fallbackColor = '#CED6E0'
const fixedSizeExtensions = new Set(['woff', 'woff2', 'ttf', 'otf', 'png', 'jpg', 'svg'])

export const layoutTree = (tree: TreeNode): PositionedNode[] => {
    const packed = packTree(tree)
    const children = packed.children && reflowSiblings(packed.children, new Map())
    return breadthFirst({ ...packed, children }).slice(0, maxChildren)
}

export const isDrawn = (node: PositionedNode): boolean => {
    return node.depth > 0 && node.depth <= maxDepth && node.data.path !== looseFilesId
}

/* Tree processing */

const processChild = (node: TreeNode, index = 0): BubbleDatum => {
    let { id, label, path, size } = node
    let children = node.children?.map(processChild)
    if (children?.length === 1) {
        const [onlyChild] = children
        label = `${label}/${onlyChild.label}`
        id = onlyChild.id
        path = onlyChild.path
        size = onlyChild.value
        children = onlyChild.children
    }
    if (node.path === '' && children) {
        children = groupLooseFiles(children)
    }
    const extension = label.slice(label.lastIndexOf('.') + 1)
    const value = sizeValue(size, extension) + index
    return {
        id,
        path,
        label,
        extension,
        value,
        // The public folder packs last
        sortOrder: label === 'public' ? -1000000 : value - index,
        color: colorFor(extension, children),
        children,
    }
}

const groupLooseFiles = (children: BubbleDatum[]): BubbleDatum[] => [
    ...children.filter((child) => child.children?.length),
    {
        id: looseFilesId,
        path: looseFilesId,
        label: looseFilesId,
        extension: '',
        value: 0,
        // NaN makes the sort comparator fall back to label order for this group
        sortOrder: NaN,
        color: fallbackColor,
        children: children.filter((child) => !child.children?.length),
    },
]

const sizeValue = (size: number, extension: string): number => {
    if (fixedSizeExtensions.has(extension)) return 100
    return Math.min(15000, fileColors.has(extension) ? size : Math.min(size, 9000))
}

const colorFor = (extension: string, children?: BubbleDatum[]): string => {
    const colorExtension = children ? dominantExtension(children) : extension
    return fileColors.get(colorExtension) ?? fallbackColor
}

const dominantExtension = (children: BubbleDatum[]): string => {
    // Object key order decides ties, so integer-like extensions come first
    const counts: Record<string, number> = Object.create(null)
    for (const { extension } of children) {
        counts[extension] = (counts[extension] ?? 0) + 1
    }
    let dominant = ''
    let dominantCount = 0
    for (const [extension, count] of Object.entries(counts)) {
        if (count > dominantCount) {
            dominant = extension
            dominantCount = count
        }
    }
    return dominant
}

/* Packing */

const packTree = (tree: TreeNode): HierarchyCircularNode<BubbleDatum> => {
    const root = hierarchy(processChild(tree))
        .sum((datum) => datum.value)
        .sort((a, b) => (b.data.sortOrder - a.data.sortOrder) || (b.data.label > a.data.label ? 1 : -1))
    return pack<BubbleDatum>()
        .size([width, height * 1.3])
        .padding(packPadding)(root)
}

const packPadding = (node: HierarchyCircularNode<BubbleDatum>): number => {
    if (node.depth <= 0) return 0
    const leafCount = node.children?.filter((child) => !child.children?.length).length ?? 0
    return leafCount > 1 ? 5 : 13
}

/* Reflow */

const reflowSiblings = (
    siblings: PositionedNode[],
    anchors: Map<string, Point>,
    parent?: PositionedNode,
): ReflowItem[] | undefined => {
    const items: ReflowItem[] = siblings.map((node) => ({ ...node, originalX: node.x, originalY: node.y }))
    simulate(items, anchors, parent)

    for (const item of items) {
        if (!item.children) continue
        const dx = item.x - item.originalX
        const dy = item.y - item.originalY
        item.children = item.children.map((child) => shiftSubtree(child, dx, dy))
        if (item.children.length <= 4) continue
        // Dropping this group turns its parent at maxDepth into a leaf
        if (item.depth > maxDepth) return undefined
        const childAnchors = new Map<string, Point>(
            item.children.map((child) => [child.data.path, [child.x, child.y]]),
        )
        item.children = reflowSiblings(item.children, childAnchors, item)
    }
    return items
}

const simulate = (items: ReflowItem[], anchors: Map<string, Point>, parent?: PositionedNode) => {
    const centerStrength = items[0].depth <= 2 ? 0.01 : 0
    const paddingScale = scaleSqrt().domain([maxDepth, 1]).range([3, 8]).clamp(true)
    const anchorOf = (item: ReflowItem) => anchors.get(item.data.path)

    const simulation = forceSimulation(items)
        .force('centerX', forceX(width / 2).strength(centerStrength))
        .force('centerY', forceY(height / 2).strength(centerStrength))
        .force('centerX2', forceX(parent?.x).strength(parent ? 0.3 : 0))
        .force('centerY2', forceY(parent?.y).strength(parent ? 0.8 : 0))
        .force(
            'x',
            forceX<ReflowItem>((item) => anchorOf(item)?.[0] || width / 2)
                .strength((item) => (anchorOf(item)?.[1] ? 0.5 : (width / height) * 0.3)),
        )
        .force(
            'y',
            forceY<ReflowItem>((item) => anchorOf(item)?.[1] || height / 2)
                .strength((item) => (anchorOf(item)?.[0] ? 0.5 : (height / width) * 0.3)),
        )
        .force(
            'collide',
            forceCollide<ReflowItem>((item) => (item.children ? item.r + paddingScale(item.depth) : item.r + 1.6))
                .iterations(8)
                .strength(1),
        )
        .stop()

    for (let tick = 0; tick < 280; tick++) {
        simulation.tick()
        for (const item of items) {
            item.x = keepBetween(item.r, width - item.r, item.x)
            item.y = keepBetween(item.r, height - item.r, item.y)
            if (parent) {
                const [x, y] = keepCircleInsideCircle(
                    parent.r,
                    [parent.x, parent.y],
                    item.r,
                    [item.x, item.y],
                    !!item.children?.length,
                )
                item.x = x
                item.y = y
            }
        }
    }
}

const shiftSubtree = (node: PositionedNode, dx: number, dy: number): PositionedNode => ({
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    children: node.children?.map((child) => shiftSubtree(child, dx, dy)),
})

// Same order as d3 descendants, which sets the paint order
const breadthFirst = (root: PositionedNode): PositionedNode[] => {
    const nodes = [root]
    for (const node of nodes) {
        nodes.push(...(node.children ?? []))
    }
    return nodes
}
