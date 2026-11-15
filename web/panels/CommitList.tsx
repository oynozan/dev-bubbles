import type { KeyboardEvent } from 'react'
import type { CommitInfo } from '../../shared/schema.ts'
import { formatAge, formatDate, useNow } from '../lib/time.ts'
import { keepBetween } from '../lib/utils.ts'

type CommitListProps = {
    commits: CommitInfo[]
    // Absent for the live working tree
    selectedSha: string | undefined
    isLoading: boolean
    error: string | undefined
    onSelect: (sha: string | undefined) => void
}

type CommitBannerProps = {
    sha: string
    commit: CommitInfo | undefined
    onBackToLive: () => void
}

const arrowSteps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 }

export const CommitList = ({ commits, selectedSha, isLoading, error, onSelect }: CommitListProps) => {
    const now = useNow()
    const shas = [undefined, ...commits.map((commit) => commit.sha)]
    // A shown commit that left the history makes the live row the Tab stop
    const selectedIndex = Math.max(0, shas.indexOf(selectedSha))

    // The selection follows the arrow keys like a list box, and focus follows the selection
    const moveSelection = (event: KeyboardEvent<HTMLUListElement>) => {
        const step = arrowSteps[event.key]
        if (!step) return
        event.preventDefault()
        const index = keepBetween(0, shas.length - 1, selectedIndex + step)
        onSelect(shas[index])
        event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus()
    }

    return (
        <section className="commit-panel" aria-label="Commit history">
            <h2>History</h2>
            <ul role="listbox" aria-label="Project states" aria-busy={isLoading} onKeyDown={moveSelection}>
                <li
                    role="option"
                    aria-selected={selectedSha === undefined}
                    tabIndex={selectedIndex === 0 ? 0 : -1}
                    className="commit live"
                    onClick={() => onSelect(undefined)}
                >
                    Working tree · live
                </li>
                {commits.map((commit, index) => {
                    const isSelected = commit.sha === selectedSha

                    return (
                        <li
                            key={commit.sha}
                            role="option"
                            aria-selected={isSelected}
                            tabIndex={selectedIndex === index + 1 ? 0 : -1}
                            className="commit"
                            title={`${commit.subject}\n${commit.author}, ${formatDate(commit.date)}`}
                            onClick={() => onSelect(commit.sha)}
                        >
                            <code>{shortSha(commit.sha)}</code>
                            <span className="commit-subject">{commit.subject}</span>
                            <span className="commit-age">{isSelected && isLoading ? 'loading…' : formatAge(commit.date, now)}</span>
                        </li>
                    )
                })}
            </ul>
            {error && selectedSha && (
                <p className="commit-error" role="alert">Could not load {shortSha(selectedSha)}: {error}</p>
            )}
        </section>
    )
}

export const CommitBanner = ({ sha, commit, onBackToLive }: CommitBannerProps) => (
    <section className="commit-banner" aria-label="Shown commit">
        <h2>Viewing a past commit</h2>
        <p>
            <code>{shortSha(sha)}</code> {commit?.subject}
        </p>
        {commit && <p className="commit-banner-meta">{commit.author}, {formatDate(commit.date)}</p>}
        <button type="button" onClick={onBackToLive}>Back to live</button>
    </section>
)

const shortSha = (sha: string): string => sha.slice(0, 7)
