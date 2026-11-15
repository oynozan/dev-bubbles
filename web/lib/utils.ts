export type Point = [number, number]

export const truncateString = (text: string, maxLength: number): string => {
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text
}

export const countOf = (count: number, noun: string): string => {
    return `${count.toLocaleString('en')} ${count === 1 ? noun : `${noun}s`}`
}

export const keepBetween = (min: number, max: number, value: number): number => {
    return Math.max(min, Math.min(max, value))
}

const getPositionFromAngleAndDistance = (angle: number, distance: number): Point => {
    const radians = (angle / 180) * Math.PI
    return [Math.cos(radians) * distance, Math.sin(radians) * distance]
}

const getAngleFromPosition = (x: number, y: number): number => {
    return (Math.atan2(y, x) * 180) / Math.PI
}

export const keepCircleInsideCircle = (
    parentR: number,
    parentPosition: Point,
    childR: number,
    childPosition: Point,
    isParent: boolean,
): Point => {
    const distance = Math.sqrt(
        Math.pow(parentPosition[0] - childPosition[0], 2) +
            Math.pow(parentPosition[1] - childPosition[1], 2),
    )
    const angle = getAngleFromPosition(
        childPosition[0] - parentPosition[0],
        childPosition[1] - parentPosition[1],
    )
    // Parents keep extra room near the top, where their curved label sits
    const padding = Math.min(angle < -20 && angle > -100 && isParent ? 13 : 3, parentR * 0.2)
    if (distance > parentR - childR - padding) {
        const offset = getPositionFromAngleAndDistance(angle, parentR - childR - padding)
        return [parentPosition[0] + offset[0], parentPosition[1] + offset[1]]
    }
    return childPosition
}
