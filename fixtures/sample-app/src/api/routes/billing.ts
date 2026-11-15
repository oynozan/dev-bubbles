import { Router } from 'express'
import { buildUrl } from '@lib/url'
import { requireSession, type Session } from '../../auth/session'

type Invoice = {
    id: string
    amountCents: number
    status: 'paid' | 'open'
    issuedAt: string
}

const invoicesByAccount = new Map<string, Invoice[]>([
    ['demo-user', [
        { id: 'inv_1001', amountCents: 1900, status: 'paid', issuedAt: '2026-09-01' },
        { id: 'inv_1002', amountCents: 1900, status: 'open', issuedAt: '2026-10-01' },
    ]],
])

export const billingRouter = Router()

billingRouter.get('/api/billing/:id', requireSession, (req, res) => {
    const session = res.locals.session as Session
    if (req.params.id !== session.user.id) {
        res.status(403).json({ error: 'Forbidden' })
        return
    }

    const invoices = (invoicesByAccount.get(req.params.id) ?? []).map((invoice) => ({
        ...invoice,
        pdfUrl: buildUrl(`/invoices/${invoice.id}.pdf`),
    }))
    res.json({ accountId: req.params.id, invoices })
})
