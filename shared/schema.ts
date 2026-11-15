import { z } from 'zod'

/* Node ids */

export const ROOT_ID = 'dir:'
export const UNMAPPED_ID = 'unmapped'
export const dirId = (path: string): string => `dir:${path}`
export const fileId = (path: string): string => `file:${path}`

/* components.json */

export type ComponentDef = {
    id: string
    label: string
    include: string[]
    exclude?: string[]
    children?: ComponentDef[]
}

const componentIdPattern = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/

export const componentSchema: z.ZodType<ComponentDef> = z.lazy(() =>
    z.strictObject({
        id: z.string().regex(componentIdPattern, 'use letters, digits, _ and - separated by dots')
            .refine((id) => id !== UNMAPPED_ID, `"${UNMAPPED_ID}" is reserved`),
        label: z.string().trim().min(1),
        include: z.array(z.string().min(1)),
        exclude: z.array(z.string().min(1)).optional(),
        children: z.array(componentSchema).optional(),
    }),
)

export const httpEdgeSchema = z.strictObject({
    from: z.string().min(1),
    to: z.string().min(1),
    note: z.string().optional(),
})

export const manifestSchema = z.strictObject({
    version: z.literal(1),
    ignore: z.array(z.string().min(1)).optional(),
    components: z.array(componentSchema),
    httpEdges: z.array(httpEdgeSchema).optional(),
})

export type Manifest = z.infer<typeof manifestSchema>
export type HttpEdgeDef = z.infer<typeof httpEdgeSchema>

/* bugs.json */

const markState = z.enum(['suspected', 'confirmed'])

export const markSchema = z.union([
    z.strictObject({ component: z.string().min(1), state: markState, reason: z.string().optional() }),
    z.strictObject({ file: z.string().min(1), state: markState, reason: z.string().optional() }),
], { error: 'a mark needs exactly one of component or file, a state of suspected or confirmed, and an optional reason' })

export const bugSchema = z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(['open', 'fixed']),
    marks: z.array(markSchema),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
})

export const bugsFileSchema = z.strictObject({
    version: z.literal(1),
    bugs: z.array(bugSchema),
})

export type MarkState = z.infer<typeof markState>
export type Mark = z.infer<typeof markSchema>
export type Bug = z.infer<typeof bugSchema>
export type BugsFile = z.infer<typeof bugsFileSchema>

/* layout.json */

export const pinSchema = z.tuple([z.number(), z.number()])

export const layoutFileSchema = z.strictObject({
    version: z.literal(1),
    pins: z.record(z.string(), pinSchema),
})

export type Pin = z.infer<typeof pinSchema>
export type LayoutFile = z.infer<typeof layoutFileSchema>

export const pinRequestSchema = z.strictObject({
    id: z.string().min(1),
    pin: pinSchema.nullable(),
})

export type PinRequest = z.infer<typeof pinRequestSchema>

/* Snapshot (server to client) */

export type NodeKind = 'component' | 'dir' | 'file'

export type TreeNode = {
    id: string
    kind: NodeKind
    label: string
    path?: string
    loc?: number
    children?: TreeNode[]
}

export type EdgeKind = 'import' | 'http'

export type Edge = {
    from: string
    to: string
    kind: EdgeKind
    label?: string
}

export type SnapshotMark = {
    nodeId: string
    state: MarkState
    reason?: string
}

export type SnapshotBug = {
    id: string
    title: string
    updatedAt?: string
    marks: SnapshotMark[]
}

export type Snapshot = {
    root: TreeNode
    edges: Edge[]
    bugs: SnapshotBug[]
    pins: Record<string, Pin>
    errors: string[]
    generatedAt: string
}
