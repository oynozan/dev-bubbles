/*
 * Interactive bubble map.
 * React renders the nested <g> tree for open groups only. MapController owns everything
 * that changes faster than React should, the node positions, one force simulation per
 * open sibling group, d3-zoom on the svg and d3-drag per bubble, and writes transforms
 * straight to the DOM.
 */
import { drag, forceCollide, forceSimulation, forceX, forceY, select, zoom, zoomIdentity } from 'd3'
import type { D3DragEvent, D3ZoomEvent, Simulation, SubjectPosition, ZoomTransform } from 'd3'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ROOT_ID } from '../../shared/schema.ts'
import type { Pin, PinRequest, Snapshot } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import { Breadcrumb } from '../panels/Breadcrumb.tsx'
import { Bubble } from './Bubble.tsx'
import type { BubbleActions } from './Bubble.tsx'
import {
    absolutePosition,
    findOpenIds,
    findTrail,
    fitTransform,
    forceContain,
    indexNodes,
    packTree,
    siblingGap,
    syncBubbles,
} from './layout.ts'
import type { BubbleState, LayoutNode, Size } from './layout.ts'

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
    const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set([ROOT_ID]))
    const [focusId, setFocusId] = useState(ROOT_ID)
    const [controller] = useState(() => new MapController(setOpenIds, setFocusId))
    const tree = useMemo(() => packTree(snapshot.root), [snapshot.root])
    const trail = findTrail(tree, focusId)

    useLayoutEffect(() => {
        const svg = svgRef.current
        const layer = layerRef.current
        return svg && layer ? controller.attach(svg, layer) : undefined
    }, [controller])

    useLayoutEffect(() => controller.setSnapshot(tree, snapshot.pins), [controller, tree, snapshot.pins])

    return (
        <div className="bubble-map">
            <svg ref={svgRef}>
                <g ref={layerRef}>
                    <g className="bubbles">
                        <Bubble node={tree} openIds={openIds} actions={controller} />
                    </g>
                    <g className="edges" />
                </g>
            </svg>
            <Breadcrumb trail={trail.length ? trail : [tree]} onSelect={controller.zoomTo} />
        </div>
    )
}

class MapController implements BubbleActions {
    readonly bubbles = new Map<string, BubbleState>()
    readonly tickListeners = new Set<() => void>()
    private readonly elements = new Map<string, SVGGElement>()
    private readonly simulations = new Map<string, GroupSimulation>()
    private readonly dirtyGroups = new Set<string>()
    private readonly zoomBehavior = zoom<SVGSVGElement, unknown>()
    private readonly showOpenIds: (openIds: ReadonlySet<string>) => void
    private readonly showFocus: (id: string) => void
    private tree: LayoutNode | undefined
    private nodesById = new Map<string, LayoutNode>()
    private openIds: ReadonlySet<string> = new Set([ROOT_ID])
    private view: ZoomTransform = zoomIdentity
    private size: Size = { width: 0, height: 0 }
    private svg: SVGSVGElement | undefined
    private hasFittedRoot = false

    constructor(showOpenIds: (openIds: ReadonlySet<string>) => void, showFocus: (id: string) => void) {
        this.showOpenIds = showOpenIds
        this.showFocus = showFocus
    }

    attach(svg: SVGSVGElement, layer: SVGGElement): () => void {
        this.svg = svg
        this.size = measure(svg)
        this.zoomBehavior
            .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
                // The browser reshapes every SVG label at each new scale, so labels hide until the zoom ends
                if (event.transform.k !== this.view.k) svg.classList.add('zooming')
                this.view = event.transform
                layer.setAttribute('transform', event.transform.toString())
                if (this.refreshOpenIds()) this.syncSimulations()
            })
            .on('end', () => svg.classList.remove('zooming'))
        select(svg).call(this.zoomBehavior).on('dblclick.zoom', null)
        const resizeObserver = new ResizeObserver(() => {
            this.size = measure(svg)
            this.updateRootZoom()
            if (this.refreshOpenIds()) this.syncSimulations()
        })
        resizeObserver.observe(svg)

        return () => {
            resizeObserver.disconnect()
            select(svg).interrupt().on('.zoom', null)
            for (const simulation of this.simulations.values()) simulation.stop()
            this.simulations.clear()
            this.svg = undefined
        }
    }

    setSnapshot(tree: LayoutNode, pins: Readonly<Record<string, Pin>>): void {
        for (const id of syncBubbles(this.bubbles, tree, pins)) this.dirtyGroups.add(id)
        this.tree = tree
        this.nodesById = indexNodes(tree)
        for (const [id, element] of this.elements) this.place(element, this.bubbles.get(id))
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

    zoomTo = (id: string): void => {
        const node = this.nodesById.get(id)
        if (!node || !this.svg) return
        const transform = toZoomTransform(absolutePosition(this.bubbles, id), node.r, this.size)
        select(this.svg).transition().duration(zoomDuration).call(this.zoomBehavior.transform, transform)
        this.showFocus(id)
    }

    unpin = (id: string): void => {
        const bubble = this.bubbles.get(id)
        if (bubble?.fx == null) return
        bubble.fx = null
        bubble.fy = null
        this.simulations.get(bubble.parentId)?.alpha(reheatAlpha).restart()
        savePin({ id, pin: null })
    }

    private updateRootZoom(): void {
        if (!this.tree || !this.svg || !this.size.width || !this.size.height) return
        const rootTransform = toZoomTransform([0, 0], this.tree.r, this.size)
        this.zoomBehavior.scaleExtent([rootTransform.k / 4, maxZoom])
        if (this.hasFittedRoot) return
        this.hasFittedRoot = true
        select(this.svg).call(this.zoomBehavior.transform, rootTransform)
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
        simulation.on('tick', () => this.placeAll(simulation.nodes()))
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
        for (const listener of this.tickListeners) listener()
    }

    private place(element: SVGGElement, bubble: BubbleState | undefined): void {
        if (bubble) element.setAttribute('transform', `translate(${bubble.x},${bubble.y})`)
    }

    /* Dragging */

    private bindDrag(id: string, element: SVGGElement): void {
        let start: Point = [0, 0]
        let isDragging = false

        const dragBehavior = drag<SVGGElement, unknown, SubjectPosition>()
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
                if (bubble.fx != null && bubble.fy != null) savePin({ id, pin: [bubble.fx, bubble.fy] })
            })
        select(element).call(dragBehavior)
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
