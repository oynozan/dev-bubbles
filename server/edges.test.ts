import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFixture } from '../scripts/make-fixture.ts'
import type { Edge } from '../shared/schema.ts'
import { createEdgeIndex } from './edges.ts'
import type { EdgeResult, FileStamp } from './edges.ts'

const fixtures: string[] = []

function makeRepo(): string {
    const repo = makeFixture()
    fixtures.push(repo)
    return repo
}

function listFiles(repo: string, dir = ''): FileStamp[] {
    return fs.readdirSync(path.join(repo, dir), { withFileTypes: true })
        .filter((entry) => entry.name !== '.git')
        .flatMap((entry) => {
            const filePath = dir ? `${dir}/${entry.name}` : entry.name
            if (entry.isDirectory()) return listFiles(repo, filePath)
            const { mtimeMs, size } = fs.statSync(path.join(repo, filePath))
            return [{ path: filePath, mtimeMs, size }]
        })
        .sort((a, b) => a.path.localeCompare(b.path))
}

function writeFile(repo: string, filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(path.join(repo, filePath)), { recursive: true })
    fs.writeFileSync(path.join(repo, filePath), content)
}

function importTargets(edges: Edge[], fromPath: string): string[] {
    return edges.filter((edge) => edge.kind === 'import' && edge.from === `file:${fromPath}`)
        .map((edge) => edge.to.replace(/^file:/, ''))
        .sort()
}

afterAll(() => {
    for (const repo of fixtures) fs.rmSync(repo, { recursive: true, force: true })
})

describe('createEdgeIndex on the sample app', () => {
    let result: EdgeResult

    beforeAll(async () => {
        const repo = makeRepo()
        writeFile(repo, 'node_modules/express/package.json', '{ "name": "express", "main": "index.js" }')
        writeFile(repo, 'node_modules/express/index.js', 'module.exports = {}')
        result = await createEdgeIndex(repo).update(listFiles(repo), {
            version: 1,
            components: [],
            edges: [{ from: 'native', to: 'auth', kind: 'import', note: 'use crate::auth' }],
            httpEdges: [
                { from: 'web', to: 'api.billing', note: 'calls BILLING_URL from env' },
                { from: 'web', to: 'auth' },
            ],
        })
    })

    it('resolves the tsconfig paths alias', () => {
        expect(importTargets(result.edges, 'src/api/routes/billing.ts')).toEqual([
            'src/auth/session.ts',
            'src/lib/url.ts',
        ])
        expect(importTargets(result.edges, 'src/auth/oauth/google/client.ts')).toEqual([
            'src/auth/oauth/providers.ts',
            'src/lib/http.ts',
            'src/lib/url.ts',
        ])
    })

    it('follows barrel re-exports', () => {
        expect(importTargets(result.edges, 'src/lib/index.ts')).toEqual([
            'src/lib/http.ts',
            'src/lib/logger.ts',
            'src/lib/url.ts',
        ])
    })

    it('includes dynamic and type-only imports', () => {
        expect(importTargets(result.edges, 'src/auth/oauth/providers.ts')).toEqual([
            'src/auth/oauth/apple/client.ts',
            'src/auth/oauth/google/client.ts',
            'src/auth/session.ts',
        ])
    })

    it('includes require calls and imports of CommonJS files', () => {
        expect(importTargets(result.edges, 'src/config/load.cjs')).toEqual(['src/config/defaults.cjs'])
        expect(importTargets(result.edges, 'src/api/server.ts')).toContain('src/config/load.cjs')
    })

    it('drops imports that resolve into node_modules', () => {
        expect(importTargets(result.edges, 'src/api/server.ts')).toEqual([
            'src/api/routes/billing.ts',
            'src/api/routes/login.ts',
            'src/api/routes/users.ts',
            'src/config/load.cjs',
            'src/lib/logger.ts',
        ])
        expect(result.edges.some((edge) => edge.to.includes('node_modules'))).toBe(false)
    })

    it('links fetch calls to the matching route handlers and skips variable URLs', () => {
        const httpEdge = (from: string, to: string, label: string): Edge => (
            { from: `file:${from}`, to: `file:${to}`, kind: 'http', label }
        )
        expect(result.edges.filter((edge) => edge.kind === 'http' && edge.from.startsWith('file:'))).toEqual([
            httpEdge('web/src/App.tsx', 'src/api/routes/users.ts', 'GET /api/users/:id'),
            httpEdge('web/src/BillingPage.tsx', 'src/api/routes/billing.ts', 'GET /api/billing/:id'),
            httpEdge('web/src/LoginPage.tsx', 'src/api/routes/login.ts', 'POST /api/login'),
            httpEdge('web/src/ProfilePage.tsx', 'src/api/routes/users.ts', 'GET /api/users/:id'),
            httpEdge('web/src/ProfilePage.tsx', 'src/api/routes/users.ts', 'PATCH /api/users/:id'),
        ])
    })

    it('reports calls that match no route', () => {
        expect(result.unmatchedCalls).toEqual([{ file: 'web/src/App.tsx', method: 'POST', path: '/api/analytics' }])
    })

    it('appends manual manifest edges between components', () => {
        expect(result.edges).toContainEqual({
            from: 'web',
            to: 'api.billing',
            kind: 'http',
            label: 'calls BILLING_URL from env',
        })
        expect(result.edges).toContainEqual({ from: 'web', to: 'auth', kind: 'http' })
        expect(result.edges).toContainEqual({ from: 'native', to: 'auth', kind: 'import', label: 'use crate::auth' })
    })
})

describe('createEdgeIndex catch-all routes', () => {
    it('link only the calls that no specific route takes', async () => {
        const repo = makeRepo()
        writeFile(repo, 'src/api/spa.ts', "app.get('/*', serveIndex)\n")
        writeFile(repo, 'web/src/about.ts', "fetch('/about')\n")
        const { edges } = await createEdgeIndex(repo).update(listFiles(repo), undefined)
        expect(edges.filter((edge) => edge.to === 'file:src/api/spa.ts')).toEqual([
            { from: 'file:web/src/about.ts', to: 'file:src/api/spa.ts', kind: 'http', label: 'GET /*' },
        ])
    })
})

describe('createEdgeIndex updates', () => {
    it('follows edited, added and removed files and tsconfig changes', async () => {
        const repo = makeRepo()
        const index = createEdgeIndex(repo)
        const update = () => index.update(listFiles(repo), undefined)
        await update()

        writeFile(repo, 'src/lib/index.ts', "export * from './url'\nexport * from './retry'\n")
        expect(importTargets((await update()).edges, 'src/lib/index.ts')).toEqual(['src/lib/url.ts'])

        writeFile(repo, 'src/lib/retry.ts', 'export const retries = 3\n')
        expect(importTargets((await update()).edges, 'src/lib/index.ts')).toEqual(['src/lib/retry.ts', 'src/lib/url.ts'])

        fs.rmSync(path.join(repo, 'src/lib/retry.ts'))
        expect(importTargets((await update()).edges, 'src/lib/index.ts')).toEqual(['src/lib/url.ts'])

        writeFile(repo, 'web/src/LoginPage.tsx', 'export function LoginPage() {\n    return null\n}\n')
        expect((await update()).edges.some((edge) => edge.from === 'file:web/src/LoginPage.tsx')).toBe(false)

        writeFile(repo, 'tsconfig.json', '{ "compilerOptions": { "strict": true } }\n')
        expect(importTargets((await update()).edges, 'src/api/routes/billing.ts')).toEqual(['src/auth/session.ts'])

        writeFile(repo, 'tsconfig.json', '{ "extends": "@tsconfig/missing/tsconfig.json" }\n')
        expect(importTargets((await update()).edges, 'src/api/routes/billing.ts')).toEqual(['src/auth/session.ts'])
    })
})
