import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib'

export type SessionUser = { id: string; email: string; name?: string }

export type Session = {
    id: string
    user: SessionUser
    expiresAt: number
}

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000
const sessions = new Map<string, Session>()

export function createSession(user: SessionUser): Session {
    const session = { id: randomUUID(), user, expiresAt: Date.now() + sessionTtlMs }
    sessions.set(session.id, session)
    logger.info('session created', { userId: user.id })
    return session
}

function readSessionId(req: Request): string | undefined {
    return req.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1]
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
    const session = sessions.get(readSessionId(req) ?? '')
    if (!session || session.expiresAt < Date.now()) {
        res.status(401).json({ error: 'Not signed in' })
        return
    }
    res.locals.session = session
    next()
}
