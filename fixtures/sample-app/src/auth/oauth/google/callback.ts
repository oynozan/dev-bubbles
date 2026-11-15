import type { Request, Response } from 'express'
import { logger } from '@lib/logger'
import { createSession } from '../../session'
import { loadProvider } from '../providers'

export async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
    const { code } = req.query
    if (typeof code !== 'string') {
        res.status(400).send('Missing authorization code')
        return
    }

    const client = await loadProvider('google')
    const user = await client.exchangeCode(code)
    const session = createSession(user)

    logger.info('signed in with google', { userId: user.id })
    res.cookie('sid', session.id, { httpOnly: true, sameSite: 'lax', secure: true })
    res.redirect('/')
}
