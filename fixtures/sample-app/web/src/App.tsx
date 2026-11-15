import { useEffect, useState } from 'react'
import { BillingPage } from './BillingPage'
import { LoginPage } from './LoginPage'
import { ProfilePage } from './ProfilePage'

type Page = 'profile' | 'billing'
type CurrentUser = { id: string; name: string }

export function App() {
    const [user, setUser] = useState<CurrentUser | null>(null)
    const [page, setPage] = useState<Page>('profile')

    useEffect(() => {
        fetch('/api/users/me')
            .then((response) => (response.ok ? (response.json() as Promise<CurrentUser>) : null))
            .then(setUser)
    }, [])

    useEffect(() => {
        fetch('/api/analytics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'page_view', page }),
            keepalive: true,
        })
    }, [page])

    if (!user) {
        return <LoginPage />
    }

    return (
        <>
            <nav>
                <span>{user.name}</span>
                <button onClick={() => setPage('profile')}>Profile</button>
                <button onClick={() => setPage('billing')}>Billing</button>
            </nav>
            {page === 'profile' ? <ProfilePage id={user.id} /> : <BillingPage id={user.id} />}
        </>
    )
}
