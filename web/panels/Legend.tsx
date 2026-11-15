import { fileColors, height, width } from '../map/layout.ts'

type LegendProps = {
    fileTypes: string[]
}

export const Legend = ({ fileTypes }: LegendProps) => (
    <g transform={`translate(${width - 60}, ${height - fileTypes.length * 15 - 20})`}>
        {fileTypes.map((extension, index) => (
            <g key={extension} transform={`translate(0, ${index * 15})`}>
                <circle r="5" fill={fileColors.get(extension)} />
                <text x="10" style={{ fontSize: '14px', fontWeight: 300 }} dominantBaseline="middle">
                    .{extension}
                </text>
            </g>
        ))}
    </g>
)
