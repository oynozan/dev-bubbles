import { useEffect, useMemo, useState } from 'react'
import type { Snapshot, TreeNode } from '../shared/schema.ts'
import { BubbleMap } from './map/BubbleMap.tsx'
import { ErrorBanner } from './panels/ErrorBanner.tsx'

type StreamStatus = 'connecting' | 'live' | 'disconnected'

type SnapshotStream = {
    status: StreamStatus
    snapshot: Snapshot | undefined
}

const retryDelayMs = 2000

const statusText: Record<Exclude<StreamStatus, 'live'>, string> = {
    connecting: 'Connecting to the dev-bubbles server…',
    disconnected: 'Disconnected from the dev-bubbles server, retrying…',
}

export const App = () => {
    const { status, snapshot } = useSnapshotStream()
    const root = snapshot?.root
    const hasNoComponents = useMemo(() => !!root && !hasComponent(root), [root])

    return (
        <div className="app">
            <ErrorBanner errors={snapshot?.errors ?? []} />
            <main className="map-area">
                {snapshot && <BubbleMap snapshot={snapshot} />}
                {hasNoComponents && (
                    <p className="map-hint">No components yet. Run /map in your coding agent to name these bubbles.</p>
                )}
                {status !== 'live' && <p className="status-line" role="status">{statusText[status]}</p>}
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
