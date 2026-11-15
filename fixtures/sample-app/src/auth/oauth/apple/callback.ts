import type { Request, Response } from 'express'
import { logger } from '../../../lib'
import { createSession } from '../../session'
import { loadProvider } from '../providers'

type AppleCallbackBody = { code?: string; user?: string }
type AppleUserJson = { name?: { firstName?: string; lastName?: string } }

function parseFullName(userJson: string | undefined): string | undefined {
    if (!userJson) {
        return undefined
    }
    const { name } = JSON.parse(userJson) as AppleUserJson
    return name ? [name.firstName, name.lastName].filter(Boolean).join(' ') : undefined
}

export async function handleAppleCallback(req: Request, res: Response): Promise<void> {
    const { code, user: userJson } = req.body as AppleCallbackBody
    if (!code) {
        res.status(400).send('Missing authorization code')
        return
    }

    const client = await loadProvider('apple')
    const user = await client.exchangeCode(code)
    // Apple sends the user's name only on the first sign in
    const name = parseFullName(userJson) ?? user.name
    const session = createSession({ ...user, name })

    logger.info('signed in with apple', { userId: user.id })
    res.cookie('sid', session.id, { httpOnly: true, sameSite: 'lax', secure: true })
    res.redirect('/')
}
