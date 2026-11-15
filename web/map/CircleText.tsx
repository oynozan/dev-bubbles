import { useId } from 'react'
import type { CSSProperties } from 'react'

type CircleTextProps = {
    r: number
    rotate: number
    text: string
    style?: CSSProperties
    fill?: string
    stroke?: string
    strokeWidth?: string
}

export const CircleText = ({ r, rotate, text, ...textProps }: CircleTextProps) => {
    const id = useId()

    return (
        <>
            <path
                fill="none"
                d={`M 0 ${r} A ${r} ${r} 0 0 1 0 ${-r} A ${r} ${r} 0 0 1 0 ${r}`}
                id={id}
                transform={`rotate(${rotate})`}
                style={{ pointerEvents: 'none' }}
            />
            <text textAnchor="middle" {...textProps}>
                <textPath href={`#${id}`} startOffset="50%">
                    {text}
                </textPath>
            </text>
        </>
    )
}
