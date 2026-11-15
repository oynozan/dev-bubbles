import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot, TreeNode } from '../shared/schema.ts'
import { BubbleMap } from './map/BubbleMap.tsx'
import { CommitBanner, CommitList } from './panels/CommitList.tsx'
import { ErrorBanner } from './panels/ErrorBanner.tsx'

type StreamStatus = 'connecting' | 'live' | 'disconnected'

type SnapshotStream = {
    status: StreamStatus
    snapshot: Snapshot | undefined
}

type CommitView = {
    // Absent for the live working tree
    selectedSha?: string
    // The past snapshot on screen, which stays while the next one loads
    snapshot?: Snapshot
    isLoading: boolean
    error?: string
}

const retryDelayMs = 2000

const statusText: Record<Exclude<StreamStatus, 'live'>, string> = {
    connecting: 'Connecting to the dev-bubbles server…',
    disconnected: 'Disconnected from the dev-bubbles server, retrying…',
}

export const App = () => {
    const { status, snapshot: liveSnapshot } = useSnapshotStream()
    const { selectedSha, snapshot: commitSnapshot, isLoading, error, select } = useCommitView()
    const snapshot = commitSnapshot ?? liveSnapshot
    const root = snapshot?.root
    const hasNoComponents = useMemo(() => !!root && !hasComponent(root), [root])
    const commits = liveSnapshot?.commits ?? []
    const shownSha = snapshot?.commit
    const backToLive = useCallback(() => select(undefined), [select])

    return (
        <div className="app">
            <ErrorBanner errors={snapshot?.errors ?? []} />
            <main className="map-area">
                {snapshot && <BubbleMap snapshot={snapshot} />}
                {hasNoComponents && (
                    <p className="map-hint">No components yet. Run /map in your coding agent to name these bubbles.</p>
                )}
                {shownSha && (
                    <CommitBanner
                        sha={shownSha}
                        commit={commits.find((commit) => commit.sha === shownSha)}
                        onBackToLive={backToLive}
                    />
                )}
                <div className="map-corner">
                    {status !== 'live' && <p className="status-line" role="status">{statusText[status]}</p>}
                    {commits.length > 0 && (
                        <CommitList
                            commits={commits}
                            selectedSha={selectedSha}
                            isLoading={isLoading}
                            error={error}
                            onSelect={select}
                        />
                    )}
                </div>
            </main>
        </div>
    )
}

const hasComponent = (node: TreeNode): boolean => {
    return node.kind === 'component' || !!node.children?.some(hasComponent)
}

const useSnapshotStream = (): SnapshotStream => {
    const [status, setStatus] = useState<StreamStatus>('connecting')
    const [snapshot, setSnapshot] = useState<Snapshot>()

    useEffect(() => {
        let source: EventSource | undefined
        let retryTimer: number | undefined

        const connect = () => {
            const eventSource = new EventSource('/api/events')
            source = eventSource
            eventSource.onopen = () => setStatus('live')
            eventSource.onmessage = (event: MessageEvent<string>) => {
                setSnapshot(JSON.parse(event.data) as Snapshot)
                setStatus('live')
            }
            eventSource.onerror = () => {
                setStatus('disconnected')
                // EventSource gives up after an HTTP error, which the dev proxy answers while the server restarts
                if (eventSource.readyState === EventSource.CLOSED) retryTimer = window.setTimeout(connect, retryDelayMs)
            }
        }

        connect()
        return () => {
            window.clearTimeout(retryTimer)
            source?.close()
        }
    }, [])

    return { status, snapshot }
}

// The live stream keeps running underneath, so going back to live needs no reload
const useCommitView = (): CommitView & { select: (sha: string | undefined) => void } => {
    const [cache] = useState(() => new Map<string, Snapshot>())
    const latestSha = useRef<string | undefined>(undefined)
    const [view, setView] = useState<CommitView>({ isLoading: false })

    const select = useCallback((sha: string | undefined) => {
        latestSha.current = sha
        const cached = sha === undefined ? undefined : cache.get(sha)
        if (sha === undefined || cached) {
            setView({ selectedSha: sha, snapshot: cached, isLoading: false })
            return
        }
        setView((previous) => ({ selectedSha: sha, snapshot: previous.snapshot, isLoading: true }))
        fetchCommitSnapshot(sha).then(
            (snapshot) => {
                cache.set(sha, snapshot)
                if (latestSha.current === sha) setView({ selectedSha: sha, snapshot, isLoading: false })
            },
            (reason: unknown) => {
                if (latestSha.current !== sha) return
                const error = reason instanceof Error ? reason.message : String(reason)
                setView((previous) => ({ ...previous, isLoading: false, error }))
            },
        )
    }, [cache])

    return { ...view, select }
}

const fetchCommitSnapshot = async (sha: string): Promise<Snapshot> => {
    const response = await fetch(`/api/snapshot?commit=${encodeURIComponent(sha)}`)
    if (!response.ok) throw new Error((await response.text()).trim() || `the server answered ${response.status}`)
    return await response.json() as Snapshot
}
