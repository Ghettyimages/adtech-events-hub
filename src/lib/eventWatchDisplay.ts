/** Shared, browser-safe display rules for check history. */
export function formatCheckTimestamp(value: string | null, locale?: string, timeZone?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  // dateStyle/timeStyle cannot be combined with timeZoneName in Intl.
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function schedulerHealth(run: { startedAt: string; finishedAt: string | null; outcome: string } | null, now = Date.now()): string {
  if (!run) return 'Scheduled checks have not run yet.';
  const age = now - new Date(run.startedAt).getTime();
  if (!Number.isFinite(age) || age > 7 * 60 * 60 * 1000) return 'The scheduler has not run recently.';
  if (run.outcome === 'FAILED') return 'The latest scheduler run failed.';
  if (run.outcome === 'PARTIAL' || run.outcome === 'INCOMPLETE') return 'The latest scheduler run was incomplete.';
  if (!run.finishedAt) return 'The scheduler is running.';
  return 'The latest scheduler run completed.';
}
