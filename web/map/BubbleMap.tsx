import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { TreeNode } from '../../shared/schema.ts'
import { truncateString } from '../lib/utils.ts'
import { Legend } from '../panels/Legend.tsx'
import { CircleText } from './CircleText.tsx'
import { fileColors, height, isDrawn, layoutTree, maxDepth, width } from './layout.ts'
import type { PositionedNode } from './layout.ts'

type BubbleMapProps = {
    root: TreeNode
}

type NodeProps = {
    node: PositionedNode
}

const fileLabelStyle: CSSProperties = { pointerEvents: 'none', fontSize: '14px', fontWeight: 500 }

export const BubbleMap = ({ root }: BubbleMapProps) => {
    const nodes = useMemo(() => layoutTree(root), [root])
    const drawnNodes = nodes.filter(isDrawn)
    const folderNodes = drawnNodes.filter(hasFolderLabel)
    const fileNodes = drawnNodes.filter((node) => !node.children && node.r > 22)

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height="100%"
            style={{ background: 'white', fontFamily: 'sans-serif', overflow: 'visible' }}
        >
            {drawnNodes.map((node) => <Bubble key={node.data.id} node={node} />)}
            {folderNodes.map((node) => <FolderLabel key={node.data.id} node={node} />)}
            {fileNodes.map((node) => <FileLabel key={node.data.id} node={node} />)}
            <Legend fileTypes={listFileTypes(nodes)} />
        </svg>
    )
}

const Bubble = ({ node }: NodeProps) => {
    if (node.children) {
        return (
            <circle
                transform={translate(node)}
                r={node.r}
                fill="white"
                stroke="#290819"
                strokeOpacity="0.2"
                strokeWidth="1"
            />
        )
    }
    return <circle transform={translate(node)} r={node.r} fill={node.data.color} />
}

const FolderLabel = ({ node }: NodeProps) => {
    const { depth, r } = node
    const label = truncateString(node.data.label, r < 30 ? Math.floor(r / 2.7) + 3 : 100)
    const offsetR = r + 12 - depth * 4
    const textR = Math.max(20, offsetR - 3)
    const style = { fontSize: 16 - depth }

    return (
        <g style={{ pointerEvents: 'none' }} transform={translate(node)}>
            <CircleText
                style={style}
                r={textR}
                rotate={depth}
                fill="#374151"
                stroke="white"
                strokeWidth="6"
                text={label}
            />
            <CircleText style={style} r={textR} rotate={depth} fill="#374151" text={label} />
        </g>
    )
}

const FileLabel = ({ node }: NodeProps) => {
    const label = truncateString(node.data.label, Math.floor(node.r / 4) + 3)

    return (
        <g style={{ fill: node.data.color }} transform={translate(node)}>
            <text
                style={{ ...fileLabelStyle, opacity: 0.9 }}
                fill="#4B5563"
                textAnchor="middle"
                dominantBaseline="middle"
                stroke="white"
                strokeWidth="3"
                strokeLinejoin="round"
            >
                {label}
            </text>
            <text style={fileLabelStyle} textAnchor="middle" dominantBaseline="middle">
                {label}
            </text>
            <text
                style={{ ...fileLabelStyle, opacity: 0.9, mixBlendMode: 'color-burn' }}
                fill="#110101"
                textAnchor="middle"
                dominantBaseline="middle"
            >
                {label}
            </text>
        </g>
    )
}

const hasFolderLabel = ({ children, depth, r, data }: PositionedNode): boolean => {
    return !!children && depth !== maxDepth && r >= 16 && data.label.length <= r * 0.5
}

const listFileTypes = (nodes: PositionedNode[]): string[] => {
    // The root stands for the repo itself, so its label is not a file type
    const extensions = nodes.filter((node) => node.depth > 0).map((node) => node.data.extension)
    return [...new Set(extensions)].filter((extension) => fileColors.has(extension)).sort()
}

const translate = ({ x, y }: PositionedNode): string => `translate(${x}, ${y})`
