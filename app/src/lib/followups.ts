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
  // null = inherit the account-wide default set in Admin; a value = per-lead override.
  manager_email: string | null
  started_at: string
  started_by: string | null
  status: 'active' | 'won' | 'lost'
  created_at: string
}

// The address reminders for this sequence actually go to.
export function effectiveEmail(seq: FollowUpSequence, defaultEmail: string): string {
  const own = (seq.manager_email ?? '').trim()
  return own !== '' ? own : defaultEmail.trim()
}

export interface FollowUpStep {
  id: string
  sequence_id: string
  step_number: number
  scheduled_date: string
  channels: string[]
  // Channels ticked off so far. A week counts as done only once this covers
  // every entry in `channels` — reminders keep naming whatever is left.
  completed_channels: string[]
  status: 'pending' | 'done' | 'skipped'
  completed_at: string | null
  notes: string | null
}

export function pendingChannels(step: FollowUpStep): string[] {
  const done = new Set(step.completed_channels ?? [])
  return (step.channels ?? []).filter((c) => !done.has(c))
}

export function isChannelDone(step: FollowUpStep, channel: string): boolean {
  return (step.completed_channels ?? []).includes(channel)
}

export function stepComplete(step: FollowUpStep): boolean {
  return pendingChannels(step).length === 0
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
  return !stepComplete(step) && step.scheduled_date < todayIso()
}

export function isDueToday(step: FollowUpStep): boolean {
  return !stepComplete(step) && step.scheduled_date === todayIso()
}

export function allDone(steps: FollowUpStep[]): boolean {
  return steps.length === 5 && steps.every(stepComplete)
}

export function nextPending(steps: FollowUpStep[]): FollowUpStep | null {
  return steps.find((s) => !stepComplete(s)) ?? null
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

// A sample reminder, so the manager can verify the address and format before a
// real follow-up comes due. Uses the same builder as a live reminder.
export function buildTestReminderMailto(managerEmail: string): string {
  return buildReminderMailto(
    managerEmail,
    '[TEST] Sample Lead',
    'Sample Practice',
    1,
    todayIso(),
    [...STEP_CHANNELS[0]],
  )
}
