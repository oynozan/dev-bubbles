import { useEffect, useState } from 'react'
import type { Snapshot } from '../shared/schema.ts'
import { BubbleMap } from './map/BubbleMap.tsx'

type SnapshotState =
    | { status: 'loading' }
    | { status: 'error', message: string }
    | { status: 'ready', snapshot: Snapshot }

export const App = () => {
    const [state, setState] = useState<SnapshotState>({ status: 'loading' })

    useEffect(() => {
        fetchSnapshot().then(
            (snapshot) => setState({ status: 'ready', snapshot }),
            (error: unknown) => setState({ status: 'error', message: errorMessage(error) }),
        )
    }, [])

    if (state.status === 'loading') return <p>Loading snapshot…</p>
    if (state.status === 'error') return <p>Could not load the snapshot. {state.message}</p>
    return <BubbleMap root={state.snapshot.root} />
}

const fetchSnapshot = async (): Promise<Snapshot> => {
    const response = await fetch('/api/snapshot')
    if (!response.ok) {
        throw new Error(`GET /api/snapshot answered ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as Snapshot
}

const errorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error)
}
