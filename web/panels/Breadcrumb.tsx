type Crumb = {
    id: string
    label: string
}

type BreadcrumbProps = {
    trail: Crumb[]
    onSelect: (id: string) => void
}

export const Breadcrumb = ({ trail, onSelect }: BreadcrumbProps) => (
    <nav className="breadcrumb" aria-label="Zoom path">
        <ol>
            {trail.map((crumb, index) => (
                <li key={crumb.id}>
                    <button
                        type="button"
                        aria-current={index === trail.length - 1 ? 'location' : undefined}
                        onClick={() => onSelect(crumb.id)}
                    >
                        {crumb.label}
                    </button>
                </li>
            ))}
        </ol>
    </nav>
)
