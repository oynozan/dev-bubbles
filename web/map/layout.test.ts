import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../shared/schema.ts'
import { height, isDrawn, layoutTree, looseFilesId, width } from './layout.ts'
import type { PositionedNode } from './layout.ts'

const nameOf = (path: string): string => path.split('/').at(-1) ?? path

const file = (path: string, size: number): TreeNode => {
    return { id: `file:${path}`, label: nameOf(path), path, size }
}

const dir = (path: string, children: TreeNode[]): TreeNode => {
    return { id: `dir:${path}`, label: nameOf(path), path, size: 4096, children }
}

const files = (folder: string, count: number): TreeNode[] => {
    return Array.from({ length: count }, (_, index) => file(`${folder}/file${index}.ts`, 400 + index * 350))
}

const sampleTree = dir('', [
    file('README.md', 2400),
    file('package.json', 900),
    dir('src', [
        dir('src/api', files('src/api', 6)),
        ...files('src', 3),
        dir('src/lib', [dir('src/lib/core', files('src/lib/core', 5))]),
    ]),
    dir('web', files('web', 8)),
])

const findById = (nodes: PositionedNode[], id: string): PositionedNode | undefined => {
    return nodes.find((node) => node.data.id === id)
}

describe('layoutTree', () => {
    it('collapses a single-child directory into one node', () => {
        const nodes = layoutTree(sampleTree)
        const collapsed = findById(nodes, 'dir:src/lib/core')

        expect(collapsed?.data.label).toBe('lib/core')
        expect(collapsed?.data.path).toBe('src/lib/core')
        expect(collapsed?.children).toHaveLength(5)
        expect(findById(nodes, 'dir:src/lib')).toBeUndefined()
    })

    it('sizes a single-file folder by its file', () => {
        const tree = dir('', [dir('bin', [file('bin/cli.ts', 1200)]), dir('web', files('web', 3))])
        const collapsed = findById(layoutTree(tree), 'file:bin/cli.ts')

        expect(collapsed?.data.label).toBe('bin/cli.ts')
        expect(collapsed?.data.value).toBe(1200)
    })

    it('groups loose root files into a group that is not drawn', () => {
        const nodes = layoutTree(sampleTree)
        const group = nodes.find((node) => node.data.path === looseFilesId)

        expect(group?.depth).toBe(1)
        expect(group?.children?.map((child) => child.data.id).sort()).toEqual([
            'file:README.md',
            'file:package.json',
        ])
        expect(group && isDrawn(group)).toBe(false)
        expect(findById(nodes, 'file:README.md')?.depth).toBe(2)
    })

    it('keeps every circle inside the canvas', () => {
        const tolerance = 1e-9
        for (const { x, y, r } of layoutTree(sampleTree).filter(isDrawn)) {
            expect(x - r).toBeGreaterThanOrEqual(-tolerance)
            expect(y - r).toBeGreaterThanOrEqual(-tolerance)
            expect(x + r).toBeLessThanOrEqual(width + tolerance)
            expect(y + r).toBeLessThanOrEqual(height + tolerance)
        }
    })

    it('gives identical output for identical input', () => {
        const positions = () => layoutTree(sampleTree).map(({ data, x, y, r }) => [data.id, x, y, r])

        expect(positions()).toEqual(positions())
    })
})
