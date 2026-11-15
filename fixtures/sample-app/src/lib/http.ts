import { logger } from './logger'

export class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
    }
}

export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
    })
    if (!response.ok) {
        logger.warn('upstream request failed', { url, status: response.status })
        throw new HttpError(response.status, `POST ${url} failed with ${response.status}`)
    }
    return (await response.json()) as T
}
