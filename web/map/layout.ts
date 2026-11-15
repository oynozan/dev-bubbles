/*
 * Pure layout logic for the bubble map.
 * packTree sizes the snapshot tree with d3.pack and turns it into parent-local positions.
 * syncBubbles keeps one mutable BubbleState per node across snapshots, which the force
 * simulations move and the DOM reads. forceContain keeps a sibling group inside its parent,
 * findOpenIds decides which groups semantic zoom opens, and findVisibleId walks a node's
 * lineage to the bubble it is drawn as.
 */
import { hierarchy, pack } from 'd3'
import type { Force, HierarchyCircularNode, SimulationNodeDatum } from 'd3'
import type { NodeKind, Pin, TreeNode } from '../../shared/schema.ts'
import { keepBetween, keepCircleInsideCircle, truncateString } from '../lib/utils.ts'
import type { Point } from '../lib/utils.ts'

export type LayoutNode = {
    id: string
    // A collapsed directory chain keys its pin and spot by its outermost directory
    pinId: string
    kind: NodeKind
    label: string
    path?: string
    loc?: number
    depth: number
    r: number
    x: number
    y: number
    children?: LayoutNode[]
}

export type BubbleState = SimulationNodeDatum & {
    id: string
    pinId: string
    parentId: string
    r: number
    isGroup: boolean
    x: number
    y: number
    // The pin as saved, since containment may clamp fx and fy inside a shrunken parent
    pin?: Pin
}

export type Size = {
    width: number
    height: number
}

export type View = Size & {
    x: number
    y: number
    k: number
}

export type Lineages = ReadonlyMap<string, readonly string[]>

export type FittedLabel = {
    text: string
    fontSize: number
}

type PackNode = TreeNode & {
    pinId?: string
    children?: PackNode[]
}

export const openRadius = 60

const radiusPerSqrtLine = 2
const newNodeSpread = 0.1
const radiusTolerance = 1e-6
const fitShare = 0.9
const glyphWidth = 0.6
const rootLightness = 14
const depthLightnessStep = 3
const fileLightnessLift = 5

/* Packing */

export const packTree = (tree: TreeNode): LayoutNode => {
    const root = hierarchy(collapseChains(tree, true))
        .sum((node) => (node.children?.length ? 0 : Math.max(1, node.loc ?? 0)))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || compareIds(a.data.id, b.data.id))
    const packed = pack<PackNode>()
        .radius((node) => Math.sqrt(node.value ?? 1) * radiusPerSqrtLine)
        .padding(siblingGap)(root)
    return toLayoutNode(packed)
}

// Pack and the collide force share this gap, so a packed group starts at rest
export const siblingGap = (group: { children?: { children?: unknown }[] }): number => {
    const leafCount = group.children?.filter((child) => !child.children).length ?? 0
    return leafCount > 1 ? 5 : 13
}

const collapseChains = (node: TreeNode, isRoot: boolean): PackNode => {
    const children = node.children?.map((child) => collapseChains(child, false))
    if (!isRoot && node.kind === 'dir' && children?.length === 1) {
        const [onlyChild] = children
        return { ...onlyChild, label: `${node.label}/${onlyChild.label}`, pinId: node.id }
    }
    return { ...node, children }
}

const toLayoutNode = (node: HierarchyCircularNode<PackNode>): LayoutNode => {
    const { id, pinId = id, kind, label, path, loc } = node.data
    const parent = node.parent
    return {
        id,
        pinId,
        kind,
        label,
        path,
        loc,
        depth: node.depth,
        r: node.r,
        x: parent ? node.x - parent.x : 0,
        y: parent ? node.y - parent.y : 0,
        children: node.children?.map(toLayoutNode),
    }
}

const compareIds = (a: string, b: string): number => {
    if (a < b) return -1
    if (a > b) return 1
    return 0
}

export const indexNodes = (root: LayoutNode): Map<string, LayoutNode> => {
    const nodesById = new Map<string, LayoutNode>()
    const visit = (node: LayoutNode): void => {
        nodesById.set(node.id, node)
        node.children?.forEach(visit)
    }
    visit(root)
    return nodesById
}

// The ids from the root down to each node, which tell what a node is drawn as at any zoom
export const indexLineages = (root: LayoutNode): Map<string, string[]> => {
    const lineages = new Map<string, string[]>()
    const visit = (node: LayoutNode, parentLineage: string[]): void => {
        const lineage = [...parentLineage, node.id]
        lineages.set(node.id, lineage)
        node.children?.forEach((child) => visit(child, lineage))
    }
    visit(root, [])
    return lineages
}

export const findTrail = (node: LayoutNode, id: string): LayoutNode[] => {
    if (node.id === id) return [node]
    for (const child of node.children ?? []) {
        const trail = findTrail(child, id)
        if (trail.length) return [node, ...trail]
    }
    return []
}

/* Positions across snapshots */

// Returns the groups whose members, radii or pins changed, so only those reheat
export const syncBubbles = (
    bubbles: Map<string, BubbleState>,
    root: LayoutNode,
    pins: Readonly<Record<string, Pin>>,
): Set<string> => {
    const changedGroups = new Set<string>()
    const seen = new Set<string>()
    const previousByPinId = new Map([...bubbles.values()].map((bubble) => [bubble.pinId, bubble]))

    const visit = (node: LayoutNode, parentId: string, isFreshGroup: boolean): void => {
        seen.add(node.id)
        const previous = bubbles.get(node.id)
        const bubble = previous && previous.parentId === parentId
            ? previous
            : newBubble(node, parentId, isFreshGroup, previousByPinId.get(node.pinId))
        const isNew = bubble !== previous
        const isResized = Math.abs(bubble.r - node.r) > radiusTolerance
        const isPinMoved = applyPin(bubble, pins[node.pinId])
        bubble.r = node.r
        bubble.isGroup = !!node.children?.length
        bubbles.set(node.id, bubble)
        // Pack places a fresh group without overlaps, so it needs no reheat
        if (isResized || isPinMoved || (isNew && !isFreshGroup)) changedGroups.add(parentId)
        if (isNew && previous) changedGroups.add(previous.parentId)
        const hasSurvivors = node.children?.some((child) => bubbles.get(child.id)?.parentId === node.id)
        for (const child of node.children ?? []) visit(child, node.id, !hasSurvivors)
    }

    visit(root, '', true)
    for (const [id, bubble] of bubbles) {
        if (seen.has(id)) continue
        bubbles.delete(id)
        changedGroups.add(bubble.parentId)
    }
    return new Set([...changedGroups].filter((id) => seen.has(id)))
}

// A group with no surviving members takes the packed layout, otherwise newcomers start near its centre
const newBubble = (
    node: LayoutNode,
    parentId: string,
    isFreshGroup: boolean,
    samePinBubble: BubbleState | undefined,
): BubbleState => {
    const spread = isFreshGroup ? 1 : newNodeSpread
    // A directory chain that expands or collapses stays where it stood
    const [x, y] = samePinBubble?.parentId === parentId
        ? [samePinBubble.x, samePinBubble.y]
        : [node.x * spread, node.y * spread]
    return { id: node.id, pinId: node.pinId, parentId, r: node.r, isGroup: false, x, y }
}

const applyPin = (bubble: BubbleState, pin: Pin | undefined): boolean => {
    if (pin?.[0] === bubble.pin?.[0] && pin?.[1] === bubble.pin?.[1]) return false
    bubble.pin = pin
    bubble.fx = pin?.[0] ?? null
    bubble.fy = pin?.[1] ?? null
    if (pin) {
        bubble.x = pin[0]
        bubble.y = pin[1]
    }
    return true
}

// Lookups that share a cache within one frame walk every ancestor chain once
export const absolutePosition = (
    bubbles: ReadonlyMap<string, BubbleState>,
    id: string,
    cache = new Map<string, Point>(),
): Point => {
    const cached = cache.get(id)
    if (cached) return cached
    const bubble = bubbles.get(id)
    if (!bubble) return [0, 0]
    const [parentX, parentY] = absolutePosition(bubbles, bubble.parentId, cache)
    const position: Point = [parentX + bubble.x, parentY + bubble.y]
    cache.set(id, position)
    return position
}

/* Forces */

export const forceContain = (parentRadius: () => number): Force<BubbleState, undefined> => {
    let bubbles: BubbleState[] = []
    const force = (): void => {
        const parentR = parentRadius()
        for (const bubble of bubbles) containBubble(bubble, parentR)
    }
    force.initialize = (nodes: BubbleState[]): void => {
        bubbles = nodes
    }
    return force
}

const containBubble = (bubble: BubbleState, parentR: number): void => {
    if (bubble.fx != null && bubble.fy != null) {
        [bubble.fx, bubble.fy] = containPoint(bubble, parentR, [bubble.fx, bubble.fy])
        return
    }
    const [x, y] = containPoint(bubble, parentR, [bubble.x, bubble.y])
    if (x === bubble.x && y === bubble.y) return
    bubble.x = x
    bubble.y = y
    // Dropping only the outward velocity lets bubbles slide along the wall
    const vx = bubble.vx ?? 0
    const vy = bubble.vy ?? 0
    const outward = (vx * x + vy * y) / (x * x + y * y || 1)
    if (outward > 0) {
        bubble.vx = vx - x * outward
        bubble.vy = vy - y * outward
    }
}

const containPoint = (bubble: BubbleState, parentR: number, point: Point): Point => {
    return keepCircleInsideCircle(parentR, [0, 0], bubble.r, point, bubble.isGroup)
}

/* Zoom */

export const findOpenIds = (
    root: LayoutNode,
    bubbles: ReadonlyMap<string, { x: number, y: number }>,
    view: View,
): Set<string> => {
    const openIds = new Set([root.id])
    const visit = (node: LayoutNode, originX: number, originY: number): void => {
        for (const child of node.children ?? []) {
            const bubble = bubbles.get(child.id)
            if (!child.children?.length || !bubble) continue
            const x = originX + bubble.x
            const y = originY + bubble.y
            if (!isOpenInView(child.r, x, y, view)) continue
            openIds.add(child.id)
            visit(child, x, y)
        }
    }
    visit(root, bubbles.get(root.id)?.x ?? 0, bubbles.get(root.id)?.y ?? 0)
    return openIds
}

const isOpenInView = (r: number, x: number, y: number, view: View): boolean => {
    const screenR = r * view.k
    const screenX = x * view.k + view.x
    const screenY = y * view.k + view.y
    const nearestX = keepBetween(0, view.width, screenX)
    const nearestY = keepBetween(0, view.height, screenY)
    return screenR > openRadius && Math.hypot(screenX - nearestX, screenY - nearestY) < screenR
}

// A node inside a closed group is drawn as the outermost closed group around it
export const findVisibleId = (lineage: readonly string[], openIds: ReadonlySet<string>): string => {
    return lineage.find((id) => !openIds.has(id)) ?? lineage[lineage.length - 1]
}

export const fitTransform = (centre: Point, r: number, { width, height }: Size): Omit<View, keyof Size> => {
    const k = (Math.min(width, height) * fitShare) / (2 * r)
    return { k, x: width / 2 - centre[0] * k, y: height / 2 - centre[1] * k }
}

/* Labels and colors */

// Long labels shrink down to half the font size before they are truncated
export const fitLabel = (label: string, room: number, maxFontSize: number): FittedLabel => {
    const fontSize = keepBetween(maxFontSize / 2, maxFontSize, room / (label.length * glyphWidth))
    // The epsilon keeps a label that fits exactly from losing its last character to rounding
    const maxLength = Math.floor(room / (fontSize * glyphWidth) + 1e-9)
    return { text: truncateString(label, maxLength), fontSize }
}

// Color is reserved for status, so groups are grays that lighten with depth and files a step lighter than their group
export const bubbleFill = ({ kind, depth }: Pick<LayoutNode, 'kind' | 'depth'>): string => {
    const lightness = kind === 'file' ? groupLightness(depth - 1) + fileLightnessLift : groupLightness(depth)
    return `hsl(0, 0%, ${lightness}%)`
}

const groupLightness = (depth: number): number => rootLightness + Math.min(depth, 6) * depthLightnessStep
