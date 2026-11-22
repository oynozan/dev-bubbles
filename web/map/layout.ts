/*
 * Pure layout logic for the bubble map.
 * packTree sizes the snapshot tree with d3.pack, each leaf by the lines of its files, and turns
 * it into parent-local positions.
 * syncBubbles keeps one mutable BubbleState per node across snapshots, which the force
 * simulations move and the DOM reads. forceContain keeps a sibling group inside its parent,
 * findOpenIds decides which groups semantic zoom opens, and findVisibleId walks the lineage of
 * a node or file to the bubble it is drawn as.
 */
import { hierarchy, pack, sum } from 'd3'
import type { Force, HierarchyCircularNode, SimulationNodeDatum } from 'd3'
import { fileId } from '../../shared/schema.ts'
import type { FileRef, NodeKind, Pin, TreeNode } from '../../shared/schema.ts'
import { countOf, keepBetween, keepCircleInsideCircle, truncateString } from '../lib/utils.ts'
import type { Point } from '../lib/utils.ts'

export type LayoutNode = {
    id: string
    // A collapsed directory chain keys its pin and spot by its outermost directory
    pinId: string
    kind: NodeKind
    label: string
    path?: string
    files?: FileRef[]
    // Totals over every file under the node
    fileCount: number
    loc: number
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
    // The spot the bubble drifts back to, never fx and fy, so collisions still push a pinned bubble
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

export type Circle = {
    x: number
    y: number
    r: number
}

export type FileEntry = FileRef & {
    leaf: LayoutNode
}

export type FittedLabel = {
    text: string
    fontSize: number
}

export type FittedLines = {
    lines: string[]
    fontSize: number
}

type PackNode = TreeNode & {
    pinId?: string
    children?: PackNode[]
}

export const openRadius = 60
// In screen pixels, the same floor the stylesheet gives curved labels
export const minLabelSize = 11
// In screen pixels, the same ceiling the stylesheet gives curved labels, so a zoomed leaf keeps a name and not a poster
export const maxLabelSize = 32
// In screen pixels, below which a bubble reads as a dot and leaves its name to the tooltip
export const minLabelRadius = 6

const radiusPerSqrtLine = 2
const newNodeSpread = 0.1
const radiusTolerance = 1e-6
const fitShare = 0.9
const glyphWidth = 0.6
const maxLabelLines = 3
// Agent labels run one to three words, so only a runaway name is cut
const maxLabelLength = 40
const rootLightness = 14
const depthLightnessStep = 3

/* Packing */

export const packTree = (tree: TreeNode): LayoutNode => {
    const root = hierarchy(collapseChains(tree, true))
        .sum((node) => (node.children?.length ? 0 : leafSize(node.files)))
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

// Every file counts at least one line, so empty files and leaves still take room
const leafSize = (files: readonly FileRef[] = []): number => Math.max(1, sum(files, (file) => Math.max(1, file.loc)))

const collapseChains = (node: TreeNode, isRoot: boolean): PackNode => {
    const children = node.children?.map((child) => collapseChains(child, false))
    if (!isRoot && node.kind === 'dir' && children?.length === 1) {
        const [onlyChild] = children
        return { ...onlyChild, label: `${node.label}/${onlyChild.label}`, pinId: node.id }
    }
    return { ...node, children }
}

const toLayoutNode = (node: HierarchyCircularNode<PackNode>): LayoutNode => {
    const { id, pinId = id, kind, label, path, files } = node.data
    const parent = node.parent
    const children = node.children?.map(toLayoutNode)
    return {
        id,
        pinId,
        kind,
        label,
        path,
        files,
        fileCount: children ? sum(children, (child) => child.fileCount) : files?.length ?? 0,
        loc: children ? sum(children, (child) => child.loc) : sum(files ?? [], (file) => file.loc),
        depth: node.depth,
        r: node.r,
        x: parent ? node.x - parent.x : 0,
        y: parent ? node.y - parent.y : 0,
        children,
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

// The ids from the root down to each node and file, which tell what each is drawn as at any zoom
export const indexLineages = (root: LayoutNode): Map<string, string[]> => {
    const lineages = new Map<string, string[]>()
    const visit = (node: LayoutNode, parentLineage: string[]): void => {
        const lineage = [...parentLineage, node.id]
        lineages.set(node.id, lineage)
        for (const { path } of node.files ?? []) lineages.set(fileId(path), [...lineage, fileId(path)])
        node.children?.forEach((child) => visit(child, lineage))
    }
    visit(root, [])
    return lineages
}

export const indexFiles = (root: LayoutNode): Map<string, FileEntry> => {
    const entries = new Map<string, FileEntry>()
    const visit = (node: LayoutNode): void => {
        for (const file of node.files ?? []) entries.set(fileId(file.path), { ...file, leaf: node })
        node.children?.forEach(visit)
    }
    visit(root)
    return entries
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

export const absoluteCircle = (
    bubbles: ReadonlyMap<string, BubbleState>,
    id: string,
    cache?: Map<string, Point>,
): Circle => {
    const [x, y] = absolutePosition(bubbles, id, cache)
    return { x, y, r: bubbles.get(id)?.r ?? 0 }
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
    // Only a bubble under the pointer is fixed
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

// Directories have no name from the agent, so they go by their path
export const bubbleName = ({ kind, label, path }: Pick<LayoutNode, 'kind' | 'label' | 'path'>): string => {
    return kind === 'component' ? label : path || '/'
}

export const describeSize = ({ fileCount, loc }: Pick<LayoutNode, 'fileCount' | 'loc'>): string => {
    return `${countOf(fileCount, 'file')} · ${countOf(loc, 'line')}`
}

// The coding agent names components, so file and folder names stay in the tooltip
export const hasVisibleLabel = ({ kind, depth }: Pick<LayoutNode, 'kind' | 'depth'>): boolean => {
    return kind === 'component' || depth === 0
}

// Long labels shrink down to the minimum, by default half the font size, before they are truncated
export const fitLabel = (label: string, room: number, maxFontSize: number, minFontSize = maxFontSize / 2): FittedLabel => {
    const fontSize = keepBetween(minFontSize, maxFontSize, room / (label.length * glyphWidth))
    // The epsilon keeps a label that fits exactly from losing its last character to rounding
    const maxLength = Math.floor(room / (fontSize * glyphWidth) + 1e-9)
    return { text: truncateString(label, maxLength), fontSize }
}

// A closed or leaf label takes the fewest lines that fit its circle, or else spills over it at a readable size, and only a dot drops it
export const fitCenteredLabel = (label: string, r: number, k: number): FittedLines | undefined => {
    if (r * k < minLabelRadius) return undefined
    const minFontSize = minLabelSize / k
    const maxFontSize = keepBetween(minFontSize, maxLabelSize / k, r * 0.3)
    const fittedMinFontSize = keepBetween(minFontSize, maxLabelSize / k, r * 0.15)
    const words = truncateString(label, maxLabelLength).split(' ')
    const wraps = Array.from({ length: maxLabelLines }, (_, index) => {
        const lines = wrapWords(words, index + 1)
        // Wrapped lines sit off the centre, where the circle is narrower
        const room = lines.length > 1 ? r * 1.6 : r * 1.8
        return { lines, fontSize: Math.min(maxFontSize, room / (longestLength(lines) * glyphWidth)) }
    })
    const fit = wraps.find(({ fontSize }) => fontSize >= fittedMinFontSize)
        ?? wraps.reduce((best, wrap) => (wrap.fontSize > best.fontSize ? wrap : best))
    return { lines: fit.lines, fontSize: Math.max(minFontSize, fit.fontSize) }
}

// Breaks into at most count lines at the spaces that keep the longest line shortest
const wrapWords = (words: readonly string[], count: number): string[] => {
    let lines = [words.join(' ')]
    if (count === 1) return lines
    for (let index = 1; index < words.length; index++) {
        const split = [words.slice(0, index).join(' '), ...wrapWords(words.slice(index), count - 1)]
        if (longestLength(split) < longestLength(lines)) lines = split
    }
    return lines
}

const longestLength = (lines: readonly string[]): number => Math.max(...lines.map((line) => line.length))

// Color is reserved for status, so bubbles are grays that lighten with depth
export const bubbleFill = ({ depth }: Pick<LayoutNode, 'depth'>): string => {
    return `hsl(0, 0%, ${rootLightness + Math.min(depth, 6) * depthLightnessStep}%)`
}
