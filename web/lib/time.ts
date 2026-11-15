import { useEffect, useState } from 'react'

const ageUnits: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
]
const ageFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
// Ages count whole minutes at the finest
const nowRefreshMs = 60_000

export const formatAge = (date: string, now: number): string => {
    const seconds = (now - Date.parse(date)) / 1000
    const unit = ageUnits.find(([, unitSeconds]) => seconds >= unitSeconds)
    return unit ? ageFormat.format(-Math.floor(seconds / unit[1]), unit[0]) : 'just now'
}

export const formatDate = (date: string): string => dateFormat.format(new Date(date))

export const useNow = (): number => {
    const [now, setNow] = useState(Date.now)

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), nowRefreshMs)
        return () => window.clearInterval(timer)
    }, [])

    return now
}
