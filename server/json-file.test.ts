import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bugsFileSchema, layoutFileSchema, manifestSchema } from '../shared/schema.ts'
import { readJsonFile } from './json-file.ts'

let tempDir: string

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bubbles-json-'))
})

afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
})

function writeFile(name: string, content: unknown): string {
    const filePath = path.join(tempDir, name)
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content))
    return filePath
}

describe('readJsonFile', () => {
    it('reports a missing file', () => {
        expect(readJsonFile(path.join(tempDir, 'nope.json'), manifestSchema)).toEqual({ status: 'missing' })
    })

    it('reports invalid JSON syntax as one error', () => {
        const result = readJsonFile(writeFile('components.json', '{ "version": 1,'), manifestSchema)
        expect(result.status).toBe('invalid')
        if (result.status !== 'invalid') return
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]).toMatch(/^components\.json: /)
    })

    it('accepts a file saved with a byte order mark', () => {
        const result = readJsonFile(writeFile('bugs.json', '\uFEFF{ "version": 1, "bugs": [] }'), bugsFileSchema)
        expect(result).toEqual({ status: 'ok', value: { version: 1, bugs: [] } })
    })

    it('prefixes schema errors with the file name and JSON path', () => {
        const result = readJsonFile(writeFile('components.json', {
            version: 1,
            components: [{
                id: 'auth',
                label: 'Auth',
                include: ['src/auth/**'],
                children: [
                    { id: 'auth.ok', label: 'Ok', include: [] },
                    { id: 'auth bad', label: 'Bad', include: [] },
                ],
            }],
        }), manifestSchema)
        expect(result.status).toBe('invalid')
        if (result.status !== 'invalid') return
        expect(result.errors).toEqual([expect.stringMatching(/^components\.json: components\[0\]\.children\[1\]\.id: /)])
    })

    it('quotes record keys that are not plain names', () => {
        const result = readJsonFile(writeFile('layout.json', { version: 1, pins: { 'file:src/a.ts': [1] } }), layoutFileSchema)
        expect(result.status).toBe('invalid')
        if (result.status !== 'invalid') return
        expect(result.errors[0]).toMatch(/^layout\.json: pins\["file:src\/a\.ts"\]/)
    })
})

describe('components.json schema', () => {
    const valid = {
        version: 1,
        ignore: ['**/*.lock'],
        components: [{
            id: 'auth',
            label: 'Auth',
            include: ['src/auth/**'],
            exclude: ['**/*.test.ts'],
            children: [{ id: 'auth.oauth', label: 'OAuth', include: ['src/auth/oauth/**'] }],
        }],
        httpEdges: [{ from: 'web', to: 'auth', note: 'calls AUTH_URL' }],
    }

    it('accepts the documented shape', () => {
        expect(manifestSchema.safeParse(valid).success).toBe(true)
    })

    it.each([
        ['an unknown version', { ...valid, version: 2 }],
        ['an unknown key', { ...valid, extra: true }],
        ['the reserved unmapped id', { version: 1, components: [{ id: 'unmapped', label: 'U', include: [] }] }],
        ['an empty label', { version: 1, components: [{ id: 'a', label: ' ', include: [] }] }],
        ['an id with spaces', { version: 1, components: [{ id: 'a b', label: 'A', include: [] }] }],
    ])('rejects %s', (_name, value) => {
        expect(manifestSchema.safeParse(value).success).toBe(false)
    })
})

describe('bugs.json schema', () => {
    const bug = { id: 'b1', title: 'Login fails', status: 'open', marks: [], updatedAt: '2026-11-11T10:00:00Z' }

    it('accepts component and file marks', () => {
        const marks = [{ component: 'auth', state: 'confirmed', reason: 'why' }, { file: 'src/a.ts', state: 'suspected' }]
        expect(bugsFileSchema.safeParse({ version: 1, bugs: [{ ...bug, marks }] }).success).toBe(true)
    })

    it.each([
        ['a mark with both targets', { ...bug, marks: [{ component: 'a', file: 'b', state: 'suspected' }] }],
        ['a mark with no target', { ...bug, marks: [{ state: 'suspected' }] }],
        ['an unknown mark state', { ...bug, marks: [{ component: 'a', state: 'maybe' }] }],
        ['an unknown status', { ...bug, status: 'closed' }],
        ['a malformed date', { ...bug, updatedAt: 'yesterday' }],
    ])('rejects %s', (_name, value) => {
        expect(bugsFileSchema.safeParse({ version: 1, bugs: [value] }).success).toBe(false)
    })
})

describe('layout.json schema', () => {
    it('accepts pins keyed by node id', () => {
        expect(layoutFileSchema.safeParse({ version: 1, pins: { 'auth.oauth': [120, -40] } }).success).toBe(true)
    })

    it.each([
        ['a pin with one coordinate', { version: 1, pins: { a: [1] } }],
        ['a pin with a string coordinate', { version: 1, pins: { a: [1, '2'] } }],
        ['missing pins', { version: 1 }],
    ])('rejects %s', (_name, value) => {
        expect(layoutFileSchema.safeParse(value).success).toBe(false)
    })
})
