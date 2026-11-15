import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'

export const configDir = '.dev-bubbles'

export type JsonFileResult<T> =
    | { status: 'missing' }
    | { status: 'ok', value: T }
    | { status: 'invalid', errors: string[] }

export function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): JsonFileResult<T> {
    const fileName = path.basename(filePath)
    let data: unknown
    try {
        // Some Windows editors save JSON with a byte order mark that JSON.parse rejects
        data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
    } catch (error) {
        if (isMissingFile(error)) return { status: 'missing' }
        return { status: 'invalid', errors: [`${fileName}: ${errorMessage(error)}`] }
    }
    const result = schema.safeParse(data)
    if (result.success) return { status: 'ok', value: result.data }
    const errors = result.error.issues.map((issue) => formatError(fileName, formatJsonPath(issue.path), issue.message))
    return { status: 'invalid', errors }
}

function formatJsonPath(keys: readonly PropertyKey[]): string {
    return keys.map((key, index) => {
        if (typeof key === 'number') return `[${key}]`
        const name = String(key)
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) return `[${JSON.stringify(name)}]`
        return index === 0 ? name : `.${name}`
    }).join('')
}

function formatError(fileName: string, jsonPath: string, message: string): string {
    return jsonPath ? `${fileName}: ${jsonPath}: ${message}` : `${fileName}: ${message}`
}

function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
