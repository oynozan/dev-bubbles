import { describe, expect, it } from 'vitest'
import { jsTsAnalyzer } from './js-ts.ts'

const analyze = (path: string, lines: string[]) => jsTsAnalyzer.analyze(path, lines.join('\n'))

describe('jsTsAnalyzer', () => {
    it('matches JS and TS sources but not declaration files', () => {
        expect(['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs'].every(jsTsAnalyzer.match)).toBe(true)
        expect(['a.d.ts', 'a.json', 'a.css', 'a.md'].some(jsTsAnalyzer.match)).toBe(false)
    })

    it('collects static, type, re-export, dynamic and require specifiers', () => {
        const { imports } = analyze('src/a.ts', [
            "import { a } from './a'",
            "import type { B } from './b'",
            "import './side-effect'",
            "export * from './star'",
            "export { c } from './named'",
            "export type { D } from './types'",
            "const lazy = import('./lazy')",
            'const template = import(`./template`)',
            'const locale = import(`./locale/${lang}`)',
            'const variable = import(name)',
            "const cjs = require('./cjs')",
            "const other = load('./other')",
        ])
        expect(imports.sort()).toEqual([
            './a', './b', './cjs', './lazy', './named', './side-effect', './star', './template', './types',
        ])
    })

    it('parses JSX in plain .js files', () => {
        const analysis = analyze('src/App.js', [
            "import { Button } from './Button'",
            "export const App = () => <Button onClick={() => fetch('/api/ping')} />",
        ])
        expect(analysis).toEqual({ imports: ['./Button'], routes: [], calls: [{ method: 'GET', path: '/api/ping' }] })
    })

    it('returns what it found when the source does not parse', () => {
        expect(analyze('src/broken.ts', ["import { ok } from './ok'", 'const = = ;']).imports).toEqual(['./ok'])
    })

    it('finds Express, Fastify and Hono style routes with a handler', () => {
        const { routes } = analyze('src/server.ts', [
            "app.get('/api/health', (req, res) => res.json({}))",
            "router.post('/api/users/:id/', requireSession, updateUser)",
            "fastify.delete('/api/items/:id', async () => {})",
            "hono.all('/api/proxy/*', proxy)",
            "app.get('/api/a', listA).post('/api/b', createB)",
            "cache.get('/api/users')",
            "axios.get('/api/users', config)",
            "client.get('/api/users', { params })",
            'app.get(path, handler)',
            "app.get('api/relative', handler)",
        ])
        expect(routes).toEqual([
            { method: 'GET', path: '/api/health' },
            { method: 'POST', path: '/api/users/:id' },
            { method: 'DELETE', path: '/api/items/:id' },
            { method: 'ALL', path: '/api/proxy/*' },
            { method: 'GET', path: '/api/a' },
            { method: 'POST', path: '/api/b' },
        ])
    })

    it('leaves out client calls on HTTP client instances and caches', () => {
        const { routes } = analyze('web/src/apiClient.ts', [
            'const api = axios.create()',
            "export const createUser = (body) => api.post('/api/users', body)",
            'export async function loadUser(id) {',
            '    return api.get(`/api/users/${id}`, config)',
            '}',
            'api.put(`/api/users/${id}`, body)',
            "const users = cache.get('/api/users', fallback)",
            "this.http.post('/api/x', body).subscribe(done)",
        ])
        expect(routes).toEqual([])
    })

    it('finds Next.js route handlers from exported method names', () => {
        const { routes } = analyze('app/api/users/[id]/route.ts', [
            'export async function GET() {}',
            'export const POST = handler',
            'export { remove as DELETE }',
            'export function helper() {}',
        ])
        expect(routes.map((route) => route.method).sort()).toEqual(['DELETE', 'GET', 'POST'])
        expect(new Set(routes.map((route) => route.path))).toEqual(new Set(['/api/users/[id]']))
    })

    it('finds fetch and axios calls to literal local paths', () => {
        const { calls } = analyze('web/src/api.ts', [
            "fetch('/api/users?page=2')",
            "fetch(`/api/users/${id}/`, { method: 'delete' })",
            "fetch(`/api/users/${user.id}#top`, { 'method': `put` })",
            "axios('/api/a')",
            "axios('/api/b', { method: 'post' })",
            "axios({ url: '/api/c', method: 'patch' })",
            "axios.put('/api/d', body)",
            'fetch(url)',
            "fetch('https://example.com/api')",
            "fetch('//cdn.example.com/x')",
            'fetch(`${base}/api/e`)',
            "axios.request({ url: '/api/f' })",
        ])
        expect(calls).toEqual([
            { method: 'GET', path: '/api/users' },
            { method: 'DELETE', path: '/api/users/${id}' },
            { method: 'PUT', path: '/api/users/${}' },
            { method: 'GET', path: '/api/a' },
            { method: 'POST', path: '/api/b' },
            { method: 'PATCH', path: '/api/c' },
            { method: 'PUT', path: '/api/d' },
        ])
    })
})
