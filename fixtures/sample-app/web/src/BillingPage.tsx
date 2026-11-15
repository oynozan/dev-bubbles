import { useEffect, useState } from 'react'

type Invoice = {
    id: string
    amountCents: number
    status: 'paid' | 'open'
    issuedAt: string
    pdfUrl: string
}

type BillingSummary = { accountId: string; invoices: Invoice[] }

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function BillingPage({ id }: { id: string }) {
    const [summary, setSummary] = useState<BillingSummary | null>(null)

    useEffect(() => {
        fetch(`/api/billing/${id}`)
            .then((response) => response.json() as Promise<BillingSummary>)
            .then(setSummary)
    }, [id])

    if (!summary) {
        return <p>Loading invoices...</p>
    }

    return (
        <ul>
            {summary.invoices.map((invoice) => (
                <li key={invoice.id}>
                    {invoice.issuedAt} {currency.format(invoice.amountCents / 100)} {invoice.status}
                    <a href={invoice.pdfUrl}>Download</a>
                </li>
            ))}
        </ul>
    )
}
