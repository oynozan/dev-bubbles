import type { ReactElement } from 'react'

type LegendEntry = {
    label: string
    // Drawn in a 24 by 12 box
    symbol: ReactElement
}

const entries: LegendEntry[] = [
    { label: 'Import', symbol: <line className="edge import" x1={1} y1={6} x2={23} y2={6} /> },
    { label: 'HTTP call', symbol: <line className="edge http" x1={1} y1={6} x2={23} y2={6} /> },
]

export const Legend = () => (
    <ul className="legend" aria-label="Legend">
        {entries.map(({ label, symbol }) => (
            <li key={label}>
                <svg className="legend-symbol" viewBox="0 0 24 12" aria-hidden="true">{symbol}</svg>
                {label}
            </li>
        ))}
    </ul>
)
