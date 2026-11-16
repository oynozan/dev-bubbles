import { memo, useCallback } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import { bubbleFill, bubbleName, describeSize } from './layout.ts'
import type { LayoutNode } from './layout.ts'
import { markStatus } from './marks.ts'
import type { HiddenMarks, NodeMark } from './marks.ts'
import { mapStripesId, MarkCircle } from './patterns.tsx'

export type BubbleActions = {
    register: (id: string, element: SVGGElement) => () => void
    select: (id: string) => void
    unpin: (id: string) => void
}

type BubbleProps = {
    node: LayoutNode
    openIds: ReadonlySet<string>
    marks: ReadonlyMap<string, NodeMark>
    hiddenMarks: ReadonlyMap<string, HiddenMarks>
    selectedId: string | undefined
    actions: BubbleActions
}

const BubbleNode = ({ node, openIds, marks, hiddenMarks, selectedId, actions }: BubbleProps): ReactElement => {
    const { id, r } = node
    const isOpen = openIds.has(id)
    const mark = marks.get(id)
    const hidden = hiddenMarks.get(id)
    const register = useCallback(
        (element: SVGGElement | null) => (element ? actions.register(id, element) : undefined),
        [actions, id],
    )

    const selectOnClick = (event: MouseEvent) => {
        event.stopPropagation()
        // The second click of a double click belongs to unpinning
        if (event.detail <= 1) actions.select(id)
    }
    const unpinOnDoubleClick = (event: MouseEvent) => {
        event.stopPropagation()
        actions.unpin(id)
    }

    return (
        <g ref={register} className="bubble" data-id={id} onClick={selectOnClick} onDoubleClick={unpinOnDoubleClick}>
            <title>{tooltipOf(node)}</title>
            <circle r={r} fill={bubbleFill(node)} />
            {mark && <MarkCircle r={r} state={mark.state} isDimmed={mark.isDimmed} stripesId={mapStripesId} />}
            {isOpen && node.children?.map((child) => (
                <Bubble
                    key={child.id}
                    node={child}
                    openIds={openIds}
                    marks={marks}
                    hiddenMarks={hiddenMarks}
                    selectedId={selectedId}
                    actions={actions}
                />
            ))}
            {id === selectedId && <circle r={r} className="selection" />}
            {hidden && <circle r={r} className={`mark-ring ${markStatus(hidden)}`} />}
        </g>
    )
}

export const Bubble = memo(BubbleNode)

const tooltipOf = (node: LayoutNode): string => `${bubbleName(node)}\n${describeSize(node)}`
