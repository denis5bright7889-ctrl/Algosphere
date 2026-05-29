import { notFound } from 'next/navigation'

/**
 * Phase R1: route removed during platform refocus to trader
 * intelligence. Returns 404. The supporting components in this folder
 * are kept temporarily and will be deleted in Phase R2 (backend
 * shutdown), at which point the page directory itself is removed.
 */
export const dynamic = 'force-dynamic'
export default function Page() { notFound() }
