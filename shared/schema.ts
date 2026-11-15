export type TreeNode = {
    id: string
    label: string
    path: string
    size: number
    children?: TreeNode[]
}

export type Snapshot = {
    root: TreeNode
    generatedAt: string
}
