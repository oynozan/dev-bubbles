import { useState } from 'react'

type Provider = 'google' | 'apple'

export function LoginPage() {
    const [error, setError] = useState<string | null>(null)

    async function signIn(provider: Provider) {
        setError(null)
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider }),
        })
        if (!response.ok) {
            setError('Could not start sign in, please try again')
            return
        }
        const { redirectUrl } = (await response.json()) as { redirectUrl: string }
        window.location.assign(redirectUrl)
    }

    return (
        <main>
            <h1>Sign in</h1>
            <button onClick={() => signIn('google')}>Continue with Google</button>
            <button onClick={() => signIn('apple')}>Continue with Apple</button>
            {error && <p role="alert">{error}</p>}
        </main>
    )
}
