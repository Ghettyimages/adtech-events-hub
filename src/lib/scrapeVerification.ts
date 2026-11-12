export type VerificationIssue = { title: string; reasons: string[] };

/** A verified row with the same title does not prove a rejected occurrence was recovered. */
export function scrapeVerification(events: Array<{ title: string }>, issues: VerificationIssue[]) {
  const titleKey = (title: string) => title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const unresolved = new Map<string, VerificationIssue>();
  for (const issue of issues) {
    const key = `${titleKey(issue.title)}|${[...issue.reasons].sort().join('|')}`;
    unresolved.set(key, issue);
  }
  const verificationIssues = [...unresolved.values()];
  return {
    verificationStatus: events.length === 0 ? 'UNVERIFIED' : verificationIssues.length ? 'PARTIAL' : 'VERIFIED',
    rejectedEvents: new Set(verificationIssues.map((issue) => titleKey(issue.title))).size,
    verificationIssues,
  };
}
