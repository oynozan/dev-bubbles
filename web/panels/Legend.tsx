import { fileColors } from '../map/layout.ts'

type LegendProps = {
    fileTypes: string[]
}

export const Legend = ({ fileTypes }: LegendProps) => {
    if (!fileTypes.length) return null

    return (
        <ul className="legend" aria-label="File types">
            {fileTypes.map((extension) => (
                <li key={extension}>
                    <span className="swatch" style={{ background: fileColors.get(extension) }} />
                    .{extension}
                </li>
            ))}
        </ul>
    )
}
