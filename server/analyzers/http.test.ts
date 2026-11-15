import { describe, expect, it } from 'vitest'
import { matchesRoute, nextRoutes } from './http.ts'

describe('nextRoutes', () => {
    it('maps app router handlers to their folder path', () => {
        expect(nextRoutes('app/api/users/[id]/route.ts', ['GET', 'PATCH', 'dynamic'])).toEqual([
            { method: 'GET', path: '/api/users/[id]' },
            { method: 'PATCH', path: '/api/users/[id]' },
        ])
    })

    it('removes route groups and finds the app folder under src or a package', () => {
        expect(nextRoutes('src/app/(admin)/api/stats/route.js', ['POST'])).toEqual([
            { method: 'POST', path: '/api/stats' },
        ])
        expect(nextRoutes('apps/web/app/(shop)/api/docs/[...slug]/route.tsx', ['GET'])).toEqual([
            { method: 'GET', path: '/api/docs/[...slug]' },
        ])
        expect(nextRoutes('app/route.ts', ['GET'])).toEqual([{ method: 'GET', path: '/' }])
    })

    it('maps pages api files to ALL with index standing for its folder', () => {
        expect(nextRoutes('pages/api/users/index.ts', ['default'])).toEqual([{ method: 'ALL', path: '/api/users' }])
        expect(nextRoutes('src/pages/api/users/[id].js', [])).toEqual([{ method: 'ALL', path: '/api/users/[id]' }])
        expect(nextRoutes('pages/api/index.ts', [])).toEqual([{ method: 'ALL', path: '/api' }])
    })

    it('ignores files that are not route handlers', () => {
        expect(nextRoutes('app/api/users/page.tsx', ['GET'])).toEqual([])
        expect(nextRoutes('src/lib/route.ts', ['GET'])).toEqual([])
        expect(nextRoutes('pages/about.tsx', ['default'])).toEqual([])
    })
})

describe('matchesRoute', () => {
    const get = (path: string) => ({ method: 'GET', path })

    it.each([
        ['/api/users/me', '/api/users/:id'],
        ['/api/users/${id}', '/api/users/:id'],
        ['/api/users/${id}', '/api/users/[id]'],
        ['/api/users/${}/posts', '/api/users/:userId/posts'],
        ['/api/${resource}', '/api/users'],
        ['/api/docs/a/b/c', '/api/docs/[...slug]'],
        ['/api/docs', '/api/docs/[[...slug]]'],
        ['/static/js/app.js', '/static/*'],
    ])('matches %s to %s', (callPath, routePath) => {
        expect(matchesRoute(get(callPath), get(routePath))).toBe(true)
    })

    it.each([
        ['/api/users', '/api/users/:id'],
        ['/api/users/me/extra', '/api/users/:id'],
        ['/api/billing/1', '/api/users/:id'],
        ['/api/docs', '/api/docs/[...slug]'],
    ])('does not match %s to %s', (callPath, routePath) => {
        expect(matchesRoute(get(callPath), get(routePath))).toBe(false)
    })

    it('requires the same method unless the route accepts ALL', () => {
        const call = { method: 'POST', path: '/api/login' }
        expect(matchesRoute(call, { method: 'GET', path: '/api/login' })).toBe(false)
        expect(matchesRoute(call, { method: 'POST', path: '/api/login' })).toBe(true)
        expect(matchesRoute(call, { method: 'ALL', path: '/api/login' })).toBe(true)
    })
})
