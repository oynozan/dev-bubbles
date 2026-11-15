import { describe, expect, it } from 'vitest'
import type { Bug, TreeNode } from '../shared/schema.ts'
import { resolveBugs } from './bugs.ts'

const root: TreeNode = {
    id: 'dir:', kind: 'dir', label: 'repo', path: '', children: [
        {
            id: 'auth', kind: 'component', label: 'Auth', children: [
                { id: 'file:src/auth/session.ts', kind: 'file', label: 'session.ts', path: 'src/auth/session.ts', loc: 10 },
            ],
        },
    ],
}

function bugsFile(...bugs: Bug[]) {
    return { version: 1 as const, bugs }
}

describe('resolveBugs', () => {
    it('resolves component and file marks to node ids', () => {
        const { bugs, errors } = resolveBugs(bugsFile({
            id: 'b1',
            title: 'Login fails',
            status: 'open',
            updatedAt: '2026-11-11T10:00:00Z',
            marks: [
                { component: 'auth', state: 'suspected', reason: 'owns the session' },
                { file: 'src/auth/session.ts', state: 'confirmed' },
            ],
        }), root)
        expect(errors).toEqual([])
        expect(bugs).toEqual([{
            id: 'b1',
            title: 'Login fails',
            updatedAt: '2026-11-11T10:00:00Z',
            marks: [
                { nodeId: 'auth', state: 'suspected', reason: 'owns the session' },
                { nodeId: 'file:src/auth/session.ts', state: 'confirmed' },
            ],
        }])
    })

    it('leaves out fixed bugs', () => {
        const { bugs, errors } = resolveBugs(bugsFile(
            { id: 'b1', title: 'Old', status: 'fixed', marks: [{ component: 'gone', state: 'confirmed' }] },
            { id: 'b2', title: 'New', status: 'open', marks: [] },
        ), root)
        expect(bugs.map((bug) => bug.id)).toEqual(['b2'])
        expect(errors).toEqual([])
    })

    it('skips and reports marks whose target is not in the tree', () => {
        const { bugs, errors } = resolveBugs(bugsFile({
            id: 'b1',
            title: 'Broken',
            status: 'open',
            marks: [
                { component: 'auth.x', state: 'suspected' },
                { file: 'src/missing.ts', state: 'suspected' },
                { component: 'auth', state: 'confirmed' },
            ],
        }), root)
        expect(bugs[0].marks).toEqual([{ nodeId: 'auth', state: 'confirmed' }])
        expect(errors).toEqual([
            'bugs.json: bug b1: unknown component auth.x',
            'bugs.json: bug b1: unknown file src/missing.ts',
        ])
    })

    it('returns no bugs without a bugs file', () => {
        expect(resolveBugs(undefined, root)).toEqual({ bugs: [], errors: [] })
    })
})
