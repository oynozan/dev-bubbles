import { useEffect, useState } from 'react'
import type { MarkState, SnapshotBug, SnapshotMark } from '../../shared/schema.ts'
import type { LayoutNode } from '../map/layout.ts'
import { MarkSymbol } from '../map/patterns.tsx'

type BugPanelProps = {
    bugs: SnapshotBug[]
    selectedBug: SnapshotBug | undefined
    nodesById: ReadonlyMap<string, LayoutNode>
    onSelectBug: (bug: SnapshotBug | undefined) => void
    onSelectMark: (nodeId: string) => void
}

type MarkListProps = Pick<BugPanelProps, 'nodesById' | 'onSelectMark'> & {
    marks: SnapshotMark[]
}

const markStates: MarkState[] = ['confirmed', 'suspected']
const ageUnits: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
const ageFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const ageRefreshMs = 60_000

export const BugPanel = ({ bugs, selectedBug, nodesById, onSelectBug, onSelectMark }: BugPanelProps) => {
    const now = useNow(ageRefreshMs)

    useEffect(() => {
        if (!selectedBug) return
        const deselectOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onSelectBug(undefined)
        }
        window.addEventListener('keydown', deselectOnEscape)
        return () => window.removeEventListener('keydown', deselectOnEscape)
    }, [selectedBug, onSelectBug])

    if (!bugs.length) return null

    return (
        <section className="bug-panel" aria-label="Open bugs">
            <h2>Open bugs</h2>
            <ul>
                {bugs.map((bug) => {
                    const isSelected = bug.id === selectedBug?.id

                    return (
                        <li key={bug.id}>
                            <button
                                type="button"
                                className="bug"
                                aria-pressed={isSelected}
                                onClick={() => onSelectBug(isSelected ? undefined : bug)}
                            >
                                <span className="bug-title">{bug.title}</span>
                                <span className="bug-meta">
                                    <code>{bug.id}</code> · {countMarks(bug.marks)}
                                    {bug.updatedAt && ` · updated ${formatAge(bug.updatedAt, now)}`}
                                </span>
                            </button>
                            {isSelected && <MarkList marks={bug.marks} nodesById={nodesById} onSelectMark={onSelectMark} />}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

const MarkList = ({ marks, nodesById, onSelectMark }: MarkListProps) => {
    if (!marks.length) return <p className="bug-marks-empty">No marks yet</p>

    return (
        <ul className="bug-marks">
            {marks.map((mark, index) => (
                <li key={index}>
                    <button type="button" onClick={() => onSelectMark(mark.nodeId)}>
                        <svg className="mark-symbol" viewBox="0 0 12 12" aria-hidden="true">
                            <MarkSymbol state={mark.state} cx={6} cy={6} r={5.5} />
                        </svg>
                        <span className="mark-name">{nameOf(mark.nodeId, nodesById)}</span>
                        <span className="mark-state">{mark.state}</span>
                        {mark.reason && <span className="mark-reason">{mark.reason}</span>}
                    </button>
                </li>
            ))}
        </ul>
    )
}

// A component goes by the name the agent gave it and a file by its path
const nameOf = (id: string, nodesById: ReadonlyMap<string, LayoutNode>): string => {
    const node = nodesById.get(id)
    if (!node) return id
    return node.kind === 'file' ? node.path ?? node.label : node.label
}

const countMarks = (marks: readonly SnapshotMark[]): string => {
    const counts = markStates.flatMap((state) => {
        const count = marks.filter((mark) => mark.state === state).length
        return count ? [`${count} ${state}`] : []
    })
    return counts.join(', ') || 'no marks'
}

const formatAge = (updatedAt: string, now: number): string => {
    const seconds = (now - Date.parse(updatedAt)) / 1000
    const unit = ageUnits.find(([, unitSeconds]) => seconds >= unitSeconds)
    return unit ? ageFormat.format(-Math.floor(seconds / unit[1]), unit[0]) : 'just now'
}

const useNow = (refreshMs: number): number => {
    const [now, setNow] = useState(Date.now)

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), refreshMs)
        return () => window.clearInterval(timer)
    }, [refreshMs])

    return now
}
