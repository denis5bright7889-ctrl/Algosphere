/**
 * Feedback Center — shared types, validation, and small helpers.
 *
 * Schema mirrors supabase/migrations/20240101000074_feedback_center.sql
 * exactly. Anything that crosses the API boundary parses through these
 * zod schemas; the DB CHECK constraints catch shape drift if a future
 * migration ever falls out of sync.
 */
import { z } from 'zod'

export const FEEDBACK_TYPES = ['rating', 'question', 'bug', 'feature', 'review'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export const FEEDBACK_STATUSES = ['open', 'in_review', 'answered', 'resolved', 'closed', 'rejected'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const BUG_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type BugSeverity = (typeof BUG_SEVERITIES)[number]

export const REACTIONS = [
  'up', 'down',                                                       // submission upvote/downvote
  'helpful', 'not_helpful', 'accurate', 'excellent', 'needs_improvement', // content reactions
] as const
export type Reaction = (typeof REACTIONS)[number]

// ─── Submission schema ─────────────────────────────────────────────
// One schema per type would be more strict, but the polymorphic table
// already lets several fields be null per row. We validate the
// type-specific required fields with a refine() so the error message
// is human-readable.
export const SubmissionInputSchema = z.object({
  type:        z.enum(FEEDBACK_TYPES),
  rating:      z.number().int().min(1).max(5).optional(),
  subject:     z.string().min(2).max(200).optional(),
  body:        z.string().min(2).max(5000).optional(),
  target_kind: z.string().min(1).max(40).optional(),
  target_id:   z.string().min(1).max(120).optional(),
  severity:    z.enum(BUG_SEVERITIES).optional(),
})
  .refine((v) => v.type !== 'rating'  || typeof v.rating === 'number', {
    message: 'rating (1-5) is required for type=rating',
    path:    ['rating'],
  })
  .refine((v) => v.type !== 'bug'     || (v.subject && v.body), {
    message: 'subject and body are required for bug reports',
    path:    ['body'],
  })
  .refine((v) => v.type !== 'question' || (v.subject && v.body), {
    message: 'subject and body are required for questions',
    path:    ['body'],
  })
  .refine((v) => v.type !== 'feature'  || (v.subject && v.body), {
    message: 'subject and body are required for feature requests',
    path:    ['body'],
  })
  .refine((v) => v.type !== 'review'   || v.body, {
    message: 'body is required for reviews',
    path:    ['body'],
  })
export type SubmissionInput = z.infer<typeof SubmissionInputSchema>

// ─── Vote schema ───────────────────────────────────────────────────
// Either submission_id is set, OR target_kind+target_id are set — same
// constraint as the DB CHECK. The refine here mirrors it so we reject
// at the API edge with a useful message instead of a generic 23514.
export const VoteInputSchema = z.object({
  submission_id: z.string().uuid().optional(),
  target_kind:   z.string().min(1).max(40).optional(),
  target_id:     z.string().min(1).max(120).optional(),
  reaction:      z.enum(REACTIONS),
})
  .refine(
    (v) => (v.submission_id != null) !== (v.target_kind != null && v.target_id != null),
    { message: 'exactly one of submission_id OR (target_kind + target_id) must be set' },
  )
export type VoteInput = z.infer<typeof VoteInputSchema>

// ─── Admin update schema ───────────────────────────────────────────
export const AdminUpdateSchema = z.object({
  status:         z.enum(FEEDBACK_STATUSES).optional(),
  admin_response: z.string().min(1).max(5000).optional(),
})
  .refine((v) => v.status || v.admin_response, {
    message: 'at least one of status or admin_response is required',
  })
export type AdminUpdate = z.infer<typeof AdminUpdateSchema>

// ─── Display helpers ───────────────────────────────────────────────
export const TYPE_LABEL: Record<FeedbackType, string> = {
  rating:   'Rating',
  question: 'Question',
  bug:      'Bug Report',
  feature:  'Feature Request',
  review:   'Review',
}

export const STATUS_LABEL: Record<FeedbackStatus, { label: string; cls: string }> = {
  open:      { label: 'Open',        cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  in_review: { label: 'In review',   cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  answered:  { label: 'Answered',    cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  resolved:  { label: 'Resolved',    cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' },
  closed:    { label: 'Closed',      cls: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300' },
  rejected:  { label: 'Rejected',    cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
}

export const SEVERITY_LABEL: Record<BugSeverity, { label: string; cls: string }> = {
  low:      { label: 'Low',      cls: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300' },
  medium:   { label: 'Medium',   cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  high:     { label: 'High',     cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  critical: { label: 'Critical', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
}

// Rate-limit window for the submit endpoint.
export const SUBMIT_RATE_LIMIT_PER_HOUR = 5
