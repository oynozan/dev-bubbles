import { useState } from 'react'

type ErrorBannerProps = {
    errors: string[]
}

const collapsedCount = 3

export const ErrorBanner = ({ errors }: ErrorBannerProps) => {
    const [isExpanded, setIsExpanded] = useState(false)
    if (!errors.length) return null

    const isLong = errors.length > collapsedCount
    const shownErrors = isLong && !isExpanded ? errors.slice(0, collapsedCount) : errors

    return (
        <section className="error-banner" role="alert">
            <ul>
                {shownErrors.map((error, index) => <li key={index}>{error}</li>)}
            </ul>
            {isLong && (
                <button type="button" onClick={() => setIsExpanded(!isExpanded)}>
                    {isExpanded ? 'Show fewer' : `Show all ${errors.length} errors`}
                </button>
            )}
        </section>
    )
}
