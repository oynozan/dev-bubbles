import { Router } from 'express'
import { requireSession, type Session } from '../../auth/session'
import { logger } from '../../lib'

type User = { id: string; email: string; name: string; timezone: string }
type UserUpdate = Partial<Pick<User, 'name' | 'timezone'>>

const users = new Map<string, User>()

function currentUser(session: Session): User {
    const { id, email, name } = session.user
    return users.get(id) ?? { id, email, name: name ?? email, timezone: 'UTC' }
}

export const usersRouter = Router()

usersRouter.get('/api/users/:id', requireSession, (req, res) => {
    const user = currentUser(res.locals.session as Session)
    if (req.params.id !== 'me' && req.params.id !== user.id) {
        res.status(403).json({ error: 'Forbidden' })
        return
    }
    res.json(user)
})

usersRouter.patch('/api/users/:id', requireSession, (req, res) => {
    const user = currentUser(res.locals.session as Session)
    if (req.params.id !== user.id) {
        res.status(403).json({ error: 'Forbidden' })
        return
    }

    const { name, timezone } = req.body as UserUpdate
    const updated = { ...user, name: name ?? user.name, timezone: timezone ?? user.timezone }
    users.set(user.id, updated)
    logger.info('profile updated', { userId: user.id })
    res.json(updated)
})
