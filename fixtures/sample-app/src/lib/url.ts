const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:3000'

export function buildUrl(path: string, query: Record<string, string> = {}): string {
    const url = new URL(path, appOrigin)
    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value)
    }
    return url.toString()
}

export function callbackUrl(provider: string): string {
    return buildUrl(`/auth/${provider}/callback`)
}
