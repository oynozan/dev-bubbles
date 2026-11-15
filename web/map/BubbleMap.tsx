/*
 * Interactive bubble map.
 * React renders the nested <g> tree for open groups only, with bug marks on the bubbles and
 * the edges between the drawn bubbles in a layer above it. MapController owns everything that
 * changes faster than React should, the node positions, one force simulation per open sibling
 * group, d3-zoom on the svg, d3-drag per bubble and the edge hover highlight, and writes
 * transforms, edge paths and the counter-scaled mark stripes and badges straight to the DOM.
 */
import { drag, forceCollide, forceSimulation, forceX, forceY, select, zoom, zoomIdentity } from 'd3'
import type { D3DragEvent, D3ZoomEvent, Simulation, SubjectPosition, ZoomTransform } from 'd3'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ROOT_ID } from '../../shared/schema.ts'
import type { Pin, PinRequest, Snapshot, SnapshotBug } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import { Breadcrumb } from '../panels/Breadcrumb.tsx'
import { BugPanel } from '../panels/BugPanel.tsx'
import { Legend } from '../panels/Legend.tsx'
import { Bubble } from './Bubble.tsx'
import type { BubbleActions } from './Bubble.tsx'
import { EdgeLayer } from './EdgeLayer.tsx'
import type { EdgeActions } from './EdgeLayer.tsx'
import { aggregateEdges, edgePath, isEdgeOf } from './edges.ts'
import type { EdgeEnds } from './edges.ts'
import {
    absoluteCircle,
    absolutePosition,
    findOpenIds,
    findTrail,
    fitTransform,
    forceContain,
    hasVisibleLabel,
    indexLineages,
    indexNodes,
    packTree,
    siblingGap,
    syncBubbles,
} from './layout.ts'
import type { BubbleState, LayoutNode, Lineages, Size } from './layout.ts'
import { fitMarks, markNodes, rollUpHiddenMarks } from './marks.ts'
import { mapStripesId, StripePattern, stripeTransform } from './patterns.tsx'

type BubbleMapProps = {
    snapshot: Snapshot
}

type GroupSimulation = Simulation<BubbleState, undefined>
type BubbleDragEvent = D3DragEvent<SVGGElement, unknown, SubjectPosition>

const reheatAlpha = 0.15
const dragAlphaTarget = 0.3
const alphaDecay = 0.04
const alphaMin = 0.005
const dragThreshold = 4
const zoomDuration = 750
const maxZoom = 500

export const BubbleMap = ({ snapshot }: BubbleMapProps) => {
    const svgRef = useRef<SVGSVGElement>(null)
    const layerRef = useRef<SVGGElement>(null)
    const stripesRef = useRef<SVGPatternElement>(null)
    const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set([ROOT_ID]))
    const [focusId, setFocusId] = useState(ROOT_ID)
    const [selectedBugId, setSelectedBugId] = useState<string>()
    const [controller] = useState(() => new MapController(setOpenIds, setFocusId))
    const tree = useMemo(() => packTree(snapshot.root), [snapshot.root])
    const nodesById = useMemo(() => indexNodes(tree), [tree])
    const lineages = useMemo(() => indexLineages(tree), [tree])
    const edges = useMemo(() => aggregateEdges(snapshot.edges, lineages, openIds), [snapshot.edges, lineages, openIds])
    const selectedBug = snapshot.bugs.find((bug) => bug.id === selectedBugId)
    const marks = useMemo(() => markNodes(snapshot.bugs, selectedBug?.id), [snapshot.bugs, selectedBug?.id])
    const hiddenMarks = useMemo(() => rollUpHiddenMarks(marks, lineages, openIds), [marks, lineages, openIds])
    const trail = findTrail(tree, focusId).filter(hasVisibleLabel)

    useLayoutEffect(() => {
        const svg = svgRef.current
        const layer = layerRef.current
        const stripes = stripesRef.current
        return svg && layer && stripes ? controller.attach(svg, layer, stripes) : undefined
    }, [controller])

    useLayoutEffect(
        () => controller.setSnapshot(tree, nodesById, lineages, snapshot.pins),
        [controller, tree, nodesById, lineages, snapshot.pins],
    )

    const selectBug = useCallback((bug: SnapshotBug | undefined) => {
        setSelectedBugId(bug?.id)
        if (bug) controller.zoomToMarks(bug.marks.map((mark) => mark.nodeId))
    }, [controller])

    return (
        <div className="bubble-map">
            <svg ref={svgRef}>
                <defs>
                    <StripePattern id={mapStripesId} ref={stripesRef} />
                </defs>
                <g ref={layerRef}>
                    <g className="bubbles">
                        <Bubble
                            node={tree}
                            openIds={openIds}
                            marks={marks}
                            hiddenMarks={hiddenMarks}
                            actions={controller}
                        />
                    </g>
                    <EdgeLayer edges={edges} actions={controller} />
                </g>
            </svg>
            <Breadcrumb trail={trail.length ? trail : [tree]} onSelect={controller.zoomTo} />
            <aside className="map-side">
                <BugPanel
                    bugs={snapshot.bugs}
                    selectedBug={selectedBug}
                    nodesById={nodesById}
                    onSelectBug={selectBug}
                    onSelectMark={controller.zoomTo}
                />
                <Legend />
            </aside>
        </div>
    )
}

class MapController implements BubbleActions, EdgeActions {
    private readonly bubbles = new Map<string, BubbleState>()
    private readonly elements = new Map<string, SVGGElement>()
    private readonly edgeElements = new Map<SVGPathElement, EdgeEnds>()
    private readonly badges = new Set<SVGGElement>()
    private readonly simulations = new Map<string, GroupSimulation>()
    private readonly dirtyGroups = new Set<string>()
    private readonly zoomBehavior = zoom<SVGSVGElement, unknown>()
    private readonly showOpenIds: (openIds: ReadonlySet<string>) => void
    private readonly showFocus: (id: string) => void
    private tree: LayoutNode | undefined
    private nodesById: ReadonlyMap<string, LayoutNode> = new Map()
    private lineages: Lineages = new Map()
    private openIds: ReadonlySet<string> = new Set([ROOT_ID])
    private view: ZoomTransform = zoomIdentity
    private size: Size = { width: 0, height: 0 }
    private svg: SVGSVGElement | undefined
    private stripes: SVGPatternElement | undefined
    private lastRootFit: ZoomTransform | undefined
    private hoveredId: string | undefined
    private isEdgeDrawQueued = false

    constructor(showOpenIds: (openIds: ReadonlySet<string>) => void, showFocus: (id: string) => void) {
        this.showOpenIds = showOpenIds
        this.showFocus = showFocus
    }

    attach(svg: SVGSVGElement, layer: SVGGElement, stripes: SVGPatternElement): () => void {
        this.svg = svg
        this.stripes = stripes
        this.size = measure(svg)
        this.zoomBehavior
            .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
                const isScaling = event.transform.k !== this.view.k
                // The browser reshapes every SVG label at each new scale, so labels hide until the zoom ends
                if (isScaling) svg.classList.add('zooming')
                this.view = event.transform
                layer.setAttribute('transform', event.transform.toString())
                if (isScaling) this.counterScaleMarks()
                if (this.refreshOpenIds()) this.syncSimulations()
            })
            .on('end', () => {
                svg.classList.remove('zooming')
                // Labels are hidden while scaling, so restyling them once at the end is enough
                svg.style.setProperty('--zoom', String(this.view.k))
            })
        select(svg).call(this.zoomBehavior).on('dblclick.zoom', null)
        const resizeObserver = new ResizeObserver(() => {
            this.size = measure(svg)
            this.updateRootZoom()
            if (this.refreshOpenIds()) this.syncSimulations()
        })
        resizeObserver.observe(svg)
        svg.addEventListener('pointerover', this.highlightHovered)
        svg.addEventListener('pointerleave', this.clearHighlight)

        return () => {
            resizeObserver.disconnect()
            svg.removeEventListener('pointerover', this.highlightHovered)
            svg.removeEventListener('pointerleave', this.clearHighlight)
            select(svg).interrupt().on('.zoom', null)
            for (const simulation of this.simulations.values()) simulation.stop()
            this.simulations.clear()
            this.svg = undefined
            this.stripes = undefined
        }
    }

    setSnapshot(
        tree: LayoutNode,
        nodesById: ReadonlyMap<string, LayoutNode>,
        lineages: Lineages,
        pins: Readonly<Record<string, Pin>>,
    ): void {
        for (const id of syncBubbles(this.bubbles, tree, pins)) this.dirtyGroups.add(id)
        this.tree = tree
        this.nodesById = nodesById
        this.lineages = lineages
        for (const [id, element] of this.elements) this.place(element, this.bubbles.get(id))
        for (const [element, ends] of this.edgeElements) this.markRelated(element, ends)
        this.queueEdgeDraw()
        this.updateRootZoom()
        this.refreshOpenIds()
        this.syncSimulations()
    }

    register = (id: string, element: SVGGElement): (() => void) => {
        this.elements.set(id, element)
        this.place(element, this.bubbles.get(id))
        if (id !== ROOT_ID) this.bindDrag(id, element)
        return () => {
            if (this.elements.get(id) === element) this.elements.delete(id)
            select(element).on('.drag', null)
        }
    }

    registerEdge = (ends: EdgeEnds, element: SVGPathElement): (() => void) => {
        this.edgeElements.set(element, ends)
        this.markRelated(element, ends)
        this.queueEdgeDraw()
        return () => {
            this.edgeElements.delete(element)
        }
    }

    registerBadge = (element: SVGGElement): (() => void) => {
        this.badges.add(element)
        element.setAttribute('transform', counterScale(this.view.k))
        return () => {
            this.badges.delete(element)
        }
    }

    zoomTo = (id: string): void => {
        const node = this.nodesById.get(id)
        if (!node) return
        const transform = toZoomTransform(absolutePosition(this.bubbles, id), node.r, this.size)
        if (id === ROOT_ID) this.lastRootFit = transform
        this.animateZoom(transform, id)
    }

    zoomToMarks = (ids: readonly string[]): void => {
        const fit = fitMarks(ids, this.bubbles, this.lineages)
        if (!fit) return
        const { x, y, r } = fit.circle
        this.animateZoom(toZoomTransform([x, y], r, this.size), fit.focusId)
    }

    private animateZoom(transform: ZoomTransform, focusId: string): void {
        if (!this.svg) return
        select(this.svg).transition().duration(zoomDuration).call(this.zoomBehavior.transform, transform)
        this.showFocus(focusId)
    }

    // Stripes and badges keep their size on screen at every zoom
    private counterScaleMarks(): void {
        const { k } = this.view
        this.stripes?.setAttribute('patternTransform', stripeTransform(1 / k))
        for (const badge of this.badges) badge.setAttribute('transform', counterScale(k))
    }

    unpin = (id: string): void => {
        const bubble = this.bubbles.get(id)
        if (bubble?.fx == null) return
        bubble.fx = null
        bubble.fy = null
        bubble.pin = undefined
        this.simulations.get(bubble.parentId)?.alpha(reheatAlpha).restart()
        savePin({ id: bubble.pinId, pin: null })
    }

    // The root follows regrouping and resizing until the user moves the view away from the last fit
    private updateRootZoom(): void {
        if (!this.tree || !this.svg || !this.size.width || !this.size.height) return
        const rootFit = toZoomTransform([0, 0], this.tree.r, this.size)
        this.zoomBehavior.scaleExtent([rootFit.k / 4, maxZoom])
        const isViewUntouched = !this.lastRootFit || isSameTransform(this.view, this.lastRootFit)
        if (!isViewUntouched || isSameTransform(this.view, rootFit)) return
        this.lastRootFit = rootFit
        select(this.svg).call(this.zoomBehavior.transform, rootFit)
    }

    private refreshOpenIds(): boolean {
        if (!this.tree) return false
        const { x, y, k } = this.view
        const openIds = findOpenIds(this.tree, this.bubbles, { x, y, k, ...this.size })
        if (haveSameIds(openIds, this.openIds)) return false
        this.openIds = openIds
        this.showOpenIds(openIds)
        return true
    }

    /* Simulations */

    private syncSimulations(): void {
        for (const [id, simulation] of this.simulations) {
            if (this.openIds.has(id) && this.nodesById.has(id)) continue
            simulation.stop()
            this.simulations.delete(id)
        }
        for (const id of this.openIds) {
            const group = this.nodesById.get(id)
            if (!group?.children?.length) continue
            const simulation = this.simulations.get(id) ?? this.createSimulation(group)
            this.simulations.set(id, simulation)
            if (!this.dirtyGroups.delete(id)) continue
            simulation.nodes(this.membersOf(group)).alpha(Math.max(simulation.alpha(), reheatAlpha)).restart()
        }
    }

    private createSimulation(group: LayoutNode): GroupSimulation {
        const padding = siblingGap(group) / 2
        // The initial view centres the root, so the top-level centre pull doubles as the viewport centre force
        const centreStrength = group.id === ROOT_ID ? 0.03 : 0.06
        const simulation = forceSimulation(this.membersOf(group))
            .alpha(0)
            .alphaDecay(alphaDecay)
            .alphaMin(alphaMin)
            .force('centreX', forceX<BubbleState>(0).strength(centreStrength))
            .force('centreY', forceY<BubbleState>(0).strength(centreStrength))
            .force('collide', forceCollide<BubbleState>((bubble) => bubble.r + padding))
            .force('contain', forceContain(() => this.bubbles.get(group.id)?.r ?? group.r))
            .stop()
        simulation.on('tick', () => {
            this.placeAll(simulation.nodes())
            this.queueEdgeDraw()
        })
        return simulation
    }

    private membersOf(group: LayoutNode): BubbleState[] {
        return (group.children ?? []).flatMap((child) => this.bubbles.get(child.id) ?? [])
    }

    private placeAll(bubbles: BubbleState[]): void {
        for (const bubble of bubbles) {
            const element = this.elements.get(bubble.id)
            if (element) this.place(element, bubble)
        }
    }

    private place(element: SVGGElement, bubble: BubbleState | undefined): void {
        if (bubble) element.setAttribute('transform', `translate(${bubble.x},${bubble.y})`)
    }

    /* Edges */

    // Every open group ticks in the same frame, so the edges redraw once after the last of them
    private queueEdgeDraw(): void {
        if (this.isEdgeDrawQueued) return
        this.isEdgeDrawQueued = true
        queueMicrotask(() => {
            this.isEdgeDrawQueued = false
            this.drawEdges()
        })
    }

    private drawEdges(): void {
        const positions = new Map<string, Point>()
        const circleOf = (id: string) => absoluteCircle(this.bubbles, id, positions)
        for (const [element, { from, to }] of this.edgeElements) {
            const d = edgePath(circleOf(from), circleOf(to))
            // Rewriting a path repaints it even when unchanged, and edges outside the ticking groups stay put
            if (element.getAttribute('d') !== d) element.setAttribute('d', d)
        }
    }

    private readonly highlightHovered = (event: PointerEvent): void => {
        // An edge under the pointer keeps the highlight of the bubble it was reached from
        if (!(event.target instanceof Element) || event.target.closest('.edge')) return
        const id = event.target.closest<SVGGElement>('.bubble')?.dataset.id
        this.highlightEdgesOf(id === ROOT_ID ? undefined : id)
    }

    private readonly clearHighlight = (): void => this.highlightEdgesOf(undefined)

    private highlightEdgesOf(id: string | undefined): void {
        if (id === this.hoveredId) return
        this.hoveredId = id
        this.svg?.classList.toggle('edge-focus', id !== undefined)
        for (const [element, ends] of this.edgeElements) this.markRelated(element, ends)
    }

    private markRelated(element: SVGPathElement, ends: EdgeEnds): void {
        const id = this.hoveredId
        element.classList.toggle('related', id !== undefined && isEdgeOf(ends, id, this.lineages))
    }

    /* Dragging */

    private bindDrag(id: string, element: SVGGElement): void {
        let start: Point = [0, 0]
        let isDragging = false

        const dragBehavior = drag<SVGGElement, unknown, SubjectPosition>()
            .filter((event: MouseEvent) => !event.ctrlKey && !event.button && this.isSmallerThanView(id))
            .clickDistance(dragThreshold)
            .subject(() => {
                const bubble = this.bubbles.get(id)
                return { x: bubble?.x ?? 0, y: bubble?.y ?? 0 }
            })
            .on('start', (event: BubbleDragEvent) => {
                start = [event.x, event.y]
                isDragging = false
            })
            .on('drag', (event: BubbleDragEvent) => {
                const bubble = this.bubbles.get(id)
                if (!bubble) return
                if (!isDragging) {
                    // Below the click distance the gesture is still a click that zooms
                    if (Math.hypot(event.x - start[0], event.y - start[1]) * this.view.k < dragThreshold) return
                    isDragging = true
                    this.simulations.get(bubble.parentId)?.alphaTarget(dragAlphaTarget).restart()
                }
                bubble.fx = event.x
                bubble.fy = event.y
            })
            .on('end', () => {
                const bubble = this.bubbles.get(id)
                if (!isDragging || !bubble) return
                this.simulations.get(bubble.parentId)?.alphaTarget(0)
                if (bubble.fx == null || bubble.fy == null) return
                bubble.pin = [bubble.fx, bubble.fy]
                savePin({ id: bubble.pinId, pin: bubble.pin })
            })
        select(element).call(dragBehavior)
    }

    // A bubble bigger than the view reads as background, so a press on it pans the map
    private isSmallerThanView(id: string): boolean {
        const r = this.bubbles.get(id)?.r ?? 0
        return r * this.view.k < Math.min(this.size.width, this.size.height) / 2
    }
}

const measure = (element: Element): Size => {
    const { width, height } = element.getBoundingClientRect()
    return { width, height }
}

const toZoomTransform = (centre: Point, r: number, size: Size): ZoomTransform => {
    const { x, y, k } = fitTransform(centre, r, size)
    return zoomIdentity.translate(x, y).scale(k)
}

const counterScale = (k: number): string => `scale(${1 / k})`

const isSameTransform = (a: ZoomTransform, b: ZoomTransform): boolean => {
    return Math.abs(a.k - b.k) <= a.k * 1e-9 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
}

const haveSameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
    return a.size === b.size && [...a].every((id) => b.has(id))
}

const savePin = (request: PinRequest): void => {
    fetch('/api/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    }).then(
        (response) => {
            if (!response.ok) console.error(`POST /api/layout answered ${response.status}`)
        },
        (error: unknown) => console.error('Could not save the pin', error),
    )
}
