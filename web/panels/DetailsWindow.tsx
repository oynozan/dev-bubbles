import { memo, useEffect, useId, useRef } from 'react'
import type { PointerEvent } from 'react'
import { fileId } from '../../shared/schema.ts'
import type { FileRef, SnapshotMark } from '../../shared/schema.ts'
import { countOf, keepBetween } from '../lib/utils.ts'
import type { Point } from '../lib/utils.ts'
import type { Connection, ConnectionKind, Connections } from '../map/edges.ts'
import { bubbleName, describeSize } from '../map/layout.ts'
import type { FileEntry, LayoutNode, Lineages } from '../map/layout.ts'
import { MarkSymbol } from '../map/patterns.tsx'

// Built once per snapshot, so opening a bubble only looks things up
export type DetailsIndex = {
    nodesById: ReadonlyMap<string, LayoutNode>
    files: ReadonlyMap<string, FileEntry>
    lineages: Lineages
    connections: ReadonlyMap<string, Connections>
    marks: ReadonlyMap<string, SnapshotMark[]>
}

type DetailsWindowProps = {
    node: LayoutNode
    index: DetailsIndex
    onSelect: (id: string) => void
    onClose: () => void
}

type ContentProps = Omit<DetailsWindowProps, 'onClose'>

type EndItemProps = ContentProps & {
    id: string
    title: string
    isPath: boolean
    lines?: number
}

type ConnectionListProps = ContentProps & {
    heading: string
    connections: Connection[]
}

type ConnectionRow = {
    name: string
    // The agent's name for the bubble that holds the other file
    holder?: string
    route?: string
    targetId: string
    isInside: boolean
}

const connectionKinds: [ConnectionKind, string][] = [
    ['imports', 'Imports'],
    ['importedBy', 'Imported by'],
    ['calls', 'Calls'],
    ['calledBy', 'Called by'],
]

const DetailsWindowNode = ({ node, index, onSelect, onClose }: DetailsWindowProps) => {
    const titleId = useId()
    const windowRef = useRef<HTMLElement>(null)
    const dragOffset = useRef<Point | undefined>(undefined)

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            // The bug panel skips a handled Escape, so one press closes one thing
            event.preventDefault()
            onClose()
        }
        window.addEventListener('keydown', closeOnEscape, true)
        return () => window.removeEventListener('keydown', closeOnEscape, true)
    }, [onClose])

    useEffect(() => {
        const element = windowRef.current
        if (!element) return
        const keepInView = () => {
            const { left, top } = element.getBoundingClientRect()
            moveWindow(element, left, top)
        }
        const resizeObserver = new ResizeObserver(keepInView)
        resizeObserver.observe(element)
        window.addEventListener('resize', keepInView)
        return () => {
            resizeObserver.disconnect()
            window.removeEventListener('resize', keepInView)
        }
    }, [])

    // The position goes straight to the DOM, so dragging never renders the file list again
    const startDrag = (event: PointerEvent<HTMLElement>) => {
        const element = windowRef.current
        if (!element || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
        const { left, top } = element.getBoundingClientRect()
        dragOffset.current = [event.clientX - left, event.clientY - top]
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const drag = (event: PointerEvent<HTMLElement>) => {
        const element = windowRef.current
        const offset = dragOffset.current
        if (element && offset) moveWindow(element, event.clientX - offset[0], event.clientY - offset[1])
    }
    const endDrag = () => {
        dragOffset.current = undefined
    }

    return (
        <section ref={windowRef} className="details-window" role="dialog" aria-labelledby={titleId}>
            <header onPointerDown={startDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <div className="details-heading">
                    <h2 id={titleId}>{bubbleName(node)}</h2>
                    <p>{describeSize(node)}</p>
                </div>
                <button type="button" className="details-close" aria-label="Close details" onClick={onClose}>×</button>
            </header>
            {/* Keyed by the bubble, so a new bubble starts scrolled to the top */}
            <div key={node.id} className="details-body">
                <DetailsContent node={node} index={index} onSelect={onSelect} />
            </div>
        </section>
    )
}

export const DetailsWindow = memo(DetailsWindowNode)

const DetailsContent = ({ node, index, onSelect }: ContentProps) => {
    const ownMarks = index.marks.get(node.id)
    const bubbleEnds = listBubbles(node).filter((bubble) => index.connections.has(bubble.id))
    const sections = node.children
        ? node.children.map((child) => ({ id: child.id, heading: bubbleName(child), files: filesUnder(child) }))
        : [{ id: node.id, heading: undefined, files: node.files ?? [] }]

    return (
        <>
            {ownMarks && <MarkReasons marks={ownMarks} />}
            {bubbleEnds.length > 0 && (
                <section>
                    <h3>Component connections</h3>
                    <ul>
                        {bubbleEnds.map((bubble) => (
                            <EndItem
                                key={bubble.id}
                                id={bubble.id}
                                title={bubbleName(bubble)}
                                isPath={bubble.kind !== 'component'}
                                node={node}
                                index={index}
                                onSelect={onSelect}
                            />
                        ))}
                    </ul>
                </section>
            )}
            {sections.map((section) => (
                <section key={section.id}>
                    {section.heading && <h3>{section.heading}</h3>}
                    <ul>
                        {section.files.map((file) => (
                            <EndItem
                                key={file.path}
                                id={fileId(file.path)}
                                title={file.path}
                                isPath
                                lines={file.loc}
                                node={node}
                                index={index}
                                onSelect={onSelect}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </>
    )
}

const EndItem = ({ id, title, isPath, lines, node, index, onSelect }: EndItemProps) => {
    const connections = index.connections.get(id)
    const marks = index.marks.get(id)

    return (
        <li className="details-end">
            <div className="end-head">
                <span className={isPath ? 'end-title path' : 'end-title'}>{title}</span>
                {lines !== undefined && <span className="end-lines">{countOf(lines, 'line')}</span>}
            </div>
            {marks && <MarkReasons marks={marks} />}
            {connections && connectionKinds.map(([kind, heading]) => connections[kind].length > 0 && (
                <ConnectionList
                    key={kind}
                    heading={heading}
                    connections={connections[kind]}
                    node={node}
                    index={index}
                    onSelect={onSelect}
                />
            ))}
        </li>
    )
}

const ConnectionList = ({ heading, connections, node, index, onSelect }: ConnectionListProps) => {
    const rows = connections.map((connection) => describeConnection(connection, node, index))
    // Links that leave the open bubble say the most, so they come first
    const sorted = [...rows.filter((row) => !row.isInside), ...rows.filter((row) => row.isInside)]

    return (
        <div className="connections">
            <h4>{heading}</h4>
            <ul>
                {sorted.map((row, rowIndex) => (
                    <li key={rowIndex}>
                        <button
                            type="button"
                            className={row.isInside ? 'connection inside' : 'connection'}
                            onClick={() => onSelect(row.targetId)}
                        >
                            <span className="connection-name">{row.name}</span>
                            {row.holder && <span className="connection-holder">{row.holder}</span>}
                            {row.route && <span className="connection-route">{row.route}</span>}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    )
}

const MarkReasons = ({ marks }: { marks: SnapshotMark[] }) => (
    <ul className="details-marks">
        {marks.map((mark, markIndex) => (
            <li key={markIndex}>
                <svg className="mark-symbol" viewBox="0 0 12 12" aria-hidden="true">
                    <MarkSymbol state={mark.state} cx={6} cy={6} r={5.5} />
                </svg>
                <span className="mark-state">{mark.state}</span>
                {mark.reason && <span className="mark-reason">{mark.reason}</span>}
            </li>
        ))}
    </ul>
)

const describeConnection = ({ id, label }: Connection, node: LayoutNode, index: DetailsIndex): ConnectionRow => {
    const file = index.files.get(id)
    const target = file?.leaf ?? index.nodesById.get(id)
    return {
        name: file?.path ?? (target ? bubbleName(target) : id),
        holder: file?.leaf.kind === 'component' ? file.leaf.label : undefined,
        route: label,
        targetId: target?.id ?? id,
        isInside: index.lineages.get(id)?.includes(node.id) ?? false,
    }
}

const listBubbles = (node: LayoutNode): LayoutNode[] => [node, ...(node.children ?? []).flatMap(listBubbles)]

const filesUnder = (node: LayoutNode): FileRef[] => node.children?.flatMap(filesUnder) ?? node.files ?? []

const moveWindow = (element: HTMLElement, left: number, top: number): void => {
    element.style.left = `${keepBetween(0, window.innerWidth - element.offsetWidth, left)}px`
    element.style.top = `${keepBetween(0, window.innerHeight - element.offsetHeight, top)}px`
}
