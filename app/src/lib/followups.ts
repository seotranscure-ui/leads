export const STEP_CHANNELS: readonly (readonly string[])[] = [
  ['Email', 'SMS'],
  ['Email', 'SMS', 'Call'],
  ['Email', 'SMS', 'Call'],
  ['Email', 'SMS', 'Call'],
  ['Email', 'SMS', 'Call', 'LinkedIn'],
]

export const CHANNEL_ICON: Record<string, string> = {
  Email: '✉️',
  SMS: '💬',
  Call: '📞',
  LinkedIn: '💼',
}

export interface FollowUpSequence {
  id: string
  lead_record_id: string
  manager_email: string
  started_at: string
  started_by: string | null
  status: 'active' | 'won' | 'lost'
  created_at: string
}

export interface FollowUpStep {
  id: string
  sequence_id: string
  step_number: number
  scheduled_date: string
  channels: string[]
  status: 'pending' | 'done' | 'skipped'
  completed_at: string | null
  notes: string | null
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function defaultDates(startIso: string): string[] {
  const base = new Date(startIso + 'T12:00:00')
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i * 7)
    return d.toISOString().slice(0, 10)
  })
}

export function isOverdue(step: FollowUpStep): boolean {
  return step.status === 'pending' && step.scheduled_date < todayIso()
}

export function isDueToday(step: FollowUpStep): boolean {
  return step.status === 'pending' && step.scheduled_date === todayIso()
}

export function allDone(steps: FollowUpStep[]): boolean {
  return steps.length === 5 && steps.every((s) => s.status !== 'pending')
}

export function nextPending(steps: FollowUpStep[]): FollowUpStep | null {
  return steps.find((s) => s.status === 'pending') ?? null
}

export function buildReminderMailto(
  managerEmail: string,
  leadName: string,
  practice: string | null,
  stepNumber: number,
  scheduledDate: string,
  channels: string[],
): string {
  const subject = `Follow-Up Reminder: ${leadName} — Week ${stepNumber} of 5`
  const body = [
    `Hi,`,
    ``,
    `This is your follow-up reminder for the lead below.`,
    ``,
    `Lead: ${leadName}`,
    `Practice: ${practice ?? 'N/A'}`,
    `Week: ${stepNumber} of 5`,
    `Due: ${scheduledDate}`,
    ``,
    `Channels: ${channels.join(', ')}`,
    ``,
    `Please contact the lead and mark the step as done in the Lead Tracker.`,
    ``,
    `Thank you.`,
  ].join('\r\n')
  return `mailto:${encodeURIComponent(managerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
