import { describe, expect, it } from 'vitest'
import type { Bug } from '../shared/schema.ts'
import { resolveBugs } from './bugs.ts'

const nodeIds = new Set(['dir:', 'auth', 'file:src/auth/session.ts'])

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
        }), nodeIds)
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
        ), nodeIds)
        expect(bugs.map((bug) => bug.id)).toEqual(['b2'])
        expect(errors).toEqual([])
    })

    it('skips and reports marks whose target is not in the tree with their JSON path', () => {
        const { bugs, errors } = resolveBugs(bugsFile(
            { id: 'b1', title: 'Old', status: 'fixed', marks: [] },
            {
                id: 'b2',
                title: 'Broken',
                status: 'open',
                marks: [
                    { component: 'auth.x', state: 'suspected' },
                    { file: 'src/missing.ts', state: 'suspected' },
                    { component: 'auth', state: 'confirmed' },
                ],
            },
        ), nodeIds)
        expect(bugs[0].marks).toEqual([{ nodeId: 'auth', state: 'confirmed' }])
        expect(errors).toEqual([
            'bugs.json: bugs[1].marks[0].component: unknown component auth.x',
            'bugs.json: bugs[1].marks[1].file: unknown file src/missing.ts',
        ])
    })

    it('returns no bugs without a bugs file', () => {
        expect(resolveBugs(undefined, nodeIds)).toEqual({ bugs: [], errors: [] })
    })
})
