import { useId } from 'react'
import type { SVGProps } from 'react'

type CircleTextProps = SVGProps<SVGTextElement> & {
    r: number
    text: string
}

export const CircleText = ({ r, text, ...textProps }: CircleTextProps) => {
    const id = useId()

    return (
        <>
            <path
                fill="none"
                d={`M 0 ${r} A ${r} ${r} 0 0 1 0 ${-r} A ${r} ${r} 0 0 1 0 ${r}`}
                id={id}
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
