'use strict'

const defaults = require('./defaults.cjs')

function readNumber(value, fallback) {
    const parsed = Number(value)
    return value && Number.isFinite(parsed) ? parsed : fallback
}

function loadConfig(env = process.env) {
    return {
        port: readNumber(env.PORT, defaults.port),
        host: env.HOST ?? defaults.host,
        jsonLimit: env.JSON_LIMIT ?? defaults.jsonLimit,
        requestTimeoutMs: readNumber(env.REQUEST_TIMEOUT_MS, defaults.requestTimeoutMs),
    }
}

module.exports = { loadConfig }
