import { useEffect } from 'react'
import type { MarkState, SnapshotBug, SnapshotMark } from '../../shared/schema.ts'
import { formatAge, useNow } from '../lib/time.ts'
import { bubbleName } from '../map/layout.ts'
import type { FileEntry, LayoutNode } from '../map/layout.ts'
import { MarkSymbol } from '../map/patterns.tsx'

type BugPanelProps = {
    bugs: SnapshotBug[]
    selectedBug: SnapshotBug | undefined
    nodesById: ReadonlyMap<string, LayoutNode>
    files: ReadonlyMap<string, FileEntry>
    onSelectBug: (bug: SnapshotBug | undefined) => void
    onSelectMark: (nodeId: string) => void
}

type MarkListProps = Pick<BugPanelProps, 'nodesById' | 'files' | 'onSelectMark'> & {
    marks: SnapshotMark[]
}

const markStates: MarkState[] = ['confirmed', 'suspected']

export const BugPanel = ({ bugs, selectedBug, nodesById, files, onSelectBug, onSelectMark }: BugPanelProps) => {
    const now = useNow()

    useEffect(() => {
        if (!selectedBug) return
        const deselectOnEscape = (event: KeyboardEvent) => {
            // An open details window takes Escape first
            if (event.key === 'Escape' && !event.defaultPrevented) onSelectBug(undefined)
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
                            {isSelected && (
                                <MarkList marks={bug.marks} nodesById={nodesById} files={files} onSelectMark={onSelectMark} />
                            )}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

const MarkList = ({ marks, nodesById, files, onSelectMark }: MarkListProps) => {
    if (!marks.length) return <p className="bug-marks-empty">No marks yet</p>

    return (
        <ul className="bug-marks">
            {marks.map((mark, index) => (
                <li key={index}>
                    <button type="button" onClick={() => onSelectMark(mark.nodeId)}>
                        <svg className="mark-symbol" viewBox="0 0 12 12" aria-hidden="true">
                            <MarkSymbol state={mark.state} cx={6} cy={6} r={5.5} />
                        </svg>
                        <span className="mark-name">{nameOf(mark.nodeId, nodesById, files)}</span>
                        <span className="mark-state">{mark.state}</span>
                        {mark.reason && <span className="mark-reason">{mark.reason}</span>}
                    </button>
                </li>
            ))}
        </ul>
    )
}

// A component goes by the name the agent gave it and a file by its path
const nameOf = (id: string, nodesById: ReadonlyMap<string, LayoutNode>, files: ReadonlyMap<string, FileEntry>): string => {
    const node = nodesById.get(id)
    return node ? bubbleName(node) : files.get(id)?.path ?? id
}

const countMarks = (marks: readonly SnapshotMark[]): string => {
    const counts = markStates.flatMap((state) => {
        const count = marks.filter((mark) => mark.state === state).length
        return count ? [`${count} ${state}`] : []
    })
    return counts.join(', ') || 'no marks'
}
