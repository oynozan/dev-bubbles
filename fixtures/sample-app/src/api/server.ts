import express from 'express'
import { logger } from '@lib/logger'
import { loadConfig } from '../config/load.cjs'
import { billingRouter } from './routes/billing'
import { loginRouter } from './routes/login'
import { usersRouter } from './routes/users'

const config = loadConfig()
const app = express()

app.use(express.json({ limit: config.jsonLimit }))
app.use(express.urlencoded({ extended: false }))

app.use(loginRouter)
app.use(billingRouter)
app.use(usersRouter)

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() })
})

const server = app.listen(config.port, config.host, () => {
    logger.info('api listening', { host: config.host, port: config.port })
})
server.requestTimeout = config.requestTimeoutMs
