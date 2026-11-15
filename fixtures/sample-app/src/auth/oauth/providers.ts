import type { SessionUser } from '../session'

export type ProviderName = 'google' | 'apple'

export type OAuthClient = {
    authorizeUrl(state: string): string
    exchangeCode(code: string): Promise<SessionUser>
}

type IdTokenClaims = { sub: string; email: string; name?: string }

export function isProviderName(value: unknown): value is ProviderName {
    return value === 'google' || value === 'apple'
}

export function userFromIdToken(idToken: string): SessionUser {
    const payload = idToken.split('.')[1] ?? ''
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims
    return { id: claims.sub, email: claims.email, name: claims.name }
}

export async function loadProvider(name: ProviderName): Promise<OAuthClient> {
    if (name === 'google') {
        const { googleClient } = await import('./google/client')
        return googleClient
    }
    const { appleClient } = await import('./apple/client')
    return appleClient
}
