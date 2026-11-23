/** A public, checkable fact: "PR #<pr> in <owner>/<repo> is merged". */
export interface Milestone {
  owner: string;
  repo: string;
  pr: number;
}

export interface MilestoneResult {
  met: boolean;
  /** What the GitHub API said, kept so a signer can see why the agent proposed. */
  evidence: { url: string; state: string; merged: boolean; mergedAt: string | null; title: string };
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function milestoneId(m: Milestone): string {
  return `${m.owner}/${m.repo}#${m.pr}`;
}

/**
 * Ask the GitHub API whether the pull request is merged. Anything other than a
 * clear `merged: true` is "not met". A response that cannot be read (network
 * error, rate limit, 404) throws instead: the agent must not guess either way.
 */
export async function checkMilestone(m: Milestone, fetchImpl: typeof fetch = fetch): Promise<MilestoneResult> {
  if (!OWNER_RE.test(m.owner) || !REPO_RE.test(m.repo) || !Number.isInteger(m.pr) || m.pr < 1) {
    throw new Error(`invalid milestone ${JSON.stringify(m)}`);
  }
  const url = `https://api.github.com/repos/${m.owner}/${m.repo}/pulls/${m.pr}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'nirium-autonomous-grants-example' };
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`cannot verify milestone: GitHub answered HTTP ${res.status}`);
  const j = (await res.json()) as { state?: unknown; merged?: unknown; merged_at?: unknown; title?: unknown };
  if (typeof j.merged !== 'boolean' || typeof j.state !== 'string') throw new Error('cannot verify milestone: unexpected GitHub response');
  return {
    met: j.merged === true,
    evidence: {
      url: `https://github.com/${m.owner}/${m.repo}/pull/${m.pr}`,
      state: j.state,
      merged: j.merged,
      mergedAt: typeof j.merged_at === 'string' ? j.merged_at : null,
      title: typeof j.title === 'string' ? j.title : '',
    },
  };
}
