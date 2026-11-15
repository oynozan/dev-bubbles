import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { handleAppleCallback } from '../../auth/oauth/apple/callback'
import { handleGoogleCallback } from '../../auth/oauth/google/callback'
import { isProviderName, loadProvider } from '../../auth/oauth/providers'
import { logger } from '../../lib'

export const loginRouter = Router()

loginRouter.post('/api/login', async (req, res) => {
    const { provider } = req.body as { provider?: unknown }
    if (!isProviderName(provider)) {
        res.status(400).json({ error: 'Unknown sign in provider' })
        return
    }

    const client = await loadProvider(provider)
    logger.debug('starting oauth flow', { provider })
    res.json({ redirectUrl: client.authorizeUrl(randomUUID()) })
})

loginRouter.get('/auth/google/callback', handleGoogleCallback)
loginRouter.post('/auth/apple/callback', handleAppleCallback)
