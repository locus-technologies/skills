// Pure business rules for waterfall-email. They live under tests/ so both the
// entrypoint (./tests/rules.ts) and tests/fixtures.ts (./rules.ts) can import
// them without a parent-directory path, which the Locus API firewall rejects.

export interface Person {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  domain: string;
}

export interface Input {
  people: Person[];
  /** Try Apollo when Hunter has no deliverable email. Default true. */
  apollo_fallback: boolean;
}

export type Status = 'valid' | 'accept_all' | 'invalid' | 'unknown' | 'not_found';

export interface Result {
  id: string;
  domain: string;
  name: string;
  /** Set only when a verifier returned valid. */
  email: string | null;
  /** A found address the verifier could not confirm (accept_all or unknown). */
  risky_email: string | null;
  status: Status;
  source: 'hunter' | 'apollo' | null;
  steps: string[];
  error?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

export function parseInput(value: unknown): Input {
  if (!value || typeof value !== 'object') fail('input must be an object');
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.people) || v.people.length === 0 || v.people.length > 200) {
    fail('people must be a non-empty array of at most 200 items');
  }
  const ids = new Set<string>();
  const people = v.people.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const str = (k: string) =>
      typeof p[k] === 'string' && (p[k] as string).trim() ? (p[k] as string).trim() : undefined;
    const domain = str('domain')?.toLowerCase();
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail(`people[${i}].domain is invalid`);
    const first = str('first_name');
    const last = str('last_name');
    const full = str('full_name');
    if (!full && !(first && last)) fail(`people[${i}] needs full_name or first_name + last_name`);
    const id = str('id') ?? `${(full ?? `${first} ${last}`).toLowerCase()}@${domain}`;
    if (ids.has(id)) fail(`duplicate person id: ${id}`);
    ids.add(id);
    return {
      id,
      domain,
      ...(first ? { first_name: first } : {}),
      ...(last ? { last_name: last } : {}),
      ...(full ? { full_name: full } : {}),
    };
  });
  if (v.apollo_fallback !== undefined && typeof v.apollo_fallback !== 'boolean')
    fail('apollo_fallback must be a boolean');
  return { people, apollo_fallback: v.apollo_fallback !== false };
}

export function displayName(p: Person): string {
  return p.full_name ?? `${p.first_name} ${p.last_name}`;
}

/** Split a full name for Apollo, which wants first and last. */
export function nameParts(p: Person): { first_name: string; last_name: string } | null {
  if (p.first_name && p.last_name) return { first_name: p.first_name, last_name: p.last_name };
  const parts = (p.full_name ?? '').split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? { first_name: parts[0], last_name: parts[parts.length - 1] } : null;
}

function layer(response: unknown, key: string): Record<string, unknown> | null {
  let r = response as Record<string, unknown> | null;
  for (let depth = 0; depth < 3 && r && typeof r === 'object'; depth++) {
    if (key in r) return r;
    r = (r.data as Record<string, unknown>) ?? null;
  }
  return null;
}

/** hunter/email-finder -> { email, status } where status is the finder's own verification. */
export function hunterFound(response: unknown): { email: string | null; status: Status } {
  const d = layer(response, 'email');
  const email = typeof d?.email === 'string' && d.email.includes('@') ? d.email.toLowerCase() : null;
  if (!email) return { email: null, status: 'not_found' };
  const v = (d?.verification as Record<string, unknown> | undefined)?.status;
  return { email, status: normalizeStatus(v) };
}

/** hunter/email-verifier -> status */
export function hunterVerified(response: unknown): Status {
  const d = layer(response, 'status');
  return normalizeStatus(d?.status);
}

/** apollo/people-enrichment -> email (Apollo marks guessed emails with email_status). */
export function apolloFound(response: unknown): { email: string | null; status: Status } {
  const d = layer(response, 'person');
  const person = d?.person as Record<string, unknown> | undefined;
  const email = typeof person?.email === 'string' && person.email.includes('@') ? person.email.toLowerCase() : null;
  if (!email) return { email: null, status: 'not_found' };
  return { email, status: person?.email_status === 'verified' ? 'valid' : 'unknown' };
}

export function normalizeStatus(value: unknown): Status {
  if (value === 'valid' || value === 'deliverable' || value === 'verified') return 'valid';
  if (value === 'accept_all' || value === 'catch_all' || value === 'catch-all') return 'accept_all';
  if (value === 'invalid' || value === 'undeliverable') return 'invalid';
  return 'unknown';
}

/** The quality gate: only a verifier-confirmed address goes in `email`. */
export function finalize(
  base: Pick<Result, 'id' | 'domain' | 'name' | 'steps'>,
  candidate: { email: string | null; status: Status; source: 'hunter' | 'apollo' | null },
): Result {
  const { email, status, source } = candidate;
  return {
    ...base,
    email: email && status === 'valid' ? email : null,
    risky_email: email && (status === 'accept_all' || status === 'unknown') ? email : null,
    status: email ? status : 'not_found',
    source: email && status !== 'invalid' ? source : null,
  };
}

export function parseOutput(value: unknown): { results: Result[] } {
  const results = (value as { results?: unknown })?.results;
  if (!Array.isArray(results)) fail('output must contain results');
  for (const r of results as Result[]) {
    if (r.email && r.status !== 'valid') fail(`unverified email leaked for ${r.id}`);
  }
  return { results: results as Result[] };
}
