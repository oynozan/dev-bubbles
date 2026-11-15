import { useId } from 'react'
import type { Ref, SVGProps } from 'react'
import type { MarkState } from '../../shared/schema.ts'

type StripePatternProps = {
    id: string
    scale?: number
    ref?: Ref<SVGPatternElement>
}

type MarkCircleProps = SVGProps<SVGCircleElement> & {
    state: MarkState
    stripesId: string
    isDimmed?: boolean
}

type MarkSymbolProps = Omit<MarkCircleProps, 'stripesId'>

export const mapStripesId = 'mark-stripes'

const stripePeriod = 7
const stripeWidth = 3
const symbolStripeScale = 0.5

// The map scales its stripes by 1 / k for zoom factor k, so they keep their width on screen
export const stripeTransform = (scale: number): string => `rotate(45) scale(${scale})`

export const StripePattern = ({ id, scale = 1, ref }: StripePatternProps) => (
    <pattern
        ref={ref}
        id={id}
        className="mark-stripes"
        patternUnits="userSpaceOnUse"
        width={stripePeriod}
        height={stripePeriod}
        patternTransform={stripeTransform(scale)}
    >
        <rect width={stripeWidth} height={stripePeriod} />
    </pattern>
)

export const MarkCircle = ({ state, stripesId, isDimmed, ...circle }: MarkCircleProps) => (
    <circle
        {...circle}
        className={isDimmed ? `mark ${state} dimmed` : `mark ${state}`}
        fill={state === 'suspected' ? `url(#${stripesId})` : undefined}
    />
)

// Outside the zoomed map each symbol brings its own stripes, finer to fit a small circle
export const MarkSymbol = (props: MarkSymbolProps) => {
    const stripesId = useId()

    return (
        <>
            {props.state === 'suspected' && <StripePattern id={stripesId} scale={symbolStripeScale} />}
            <MarkCircle {...props} stripesId={stripesId} />
        </>
    )
}
