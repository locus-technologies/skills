// Pure business rules for account-signals. They live under tests/ so both the
// entrypoint (./tests/rules.ts) and tests/fixtures.ts (./rules.ts) can import
// them without a parent-directory path, which the Locus API firewall rejects.

export interface Input {
  domains: string[];
  /** Recent news per account (one Brave News call each). Default true. */
  news: boolean;
  /** Open roles per account (two Apollo calls each). Default false. */
  hiring: boolean;
}

export interface Funding {
  type: string | null;
  amount_usd: number | null;
  date: string | null;
}

export interface NewsItem {
  title: string;
  url: string;
  date: string | null;
  source: string | null;
}

export interface Account {
  domain: string;
  found: boolean;
  name: string | null;
  description: string | null;
  headcount: number | null;
  headcount_range: string | null;
  founded_year: number | null;
  country: string | null;
  city: string | null;
  industry_tags: string[];
  tech: string[];
  total_raised_usd: number | null;
  latest_funding: Funding | null;
  linkedin: string | null;
  recent_news: NewsItem[] | null;
  open_roles: { count: number; titles: string[] } | null;
  errors: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

export function parseInput(value: unknown): Input {
  if (!value || typeof value !== 'object') fail('input must be an object');
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.domains) || v.domains.length === 0 || v.domains.length > 200) {
    fail('domains must be a non-empty array of at most 200 items');
  }
  const domains = v.domains.map((d) => {
    if (typeof d !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.trim())) {
      fail(`invalid domain: ${JSON.stringify(d)}`);
    }
    return d.trim().toLowerCase();
  });
  for (const flag of ['news', 'hiring'] as const) {
    if (v[flag] !== undefined && typeof v[flag] !== 'boolean') fail(`${flag} must be a boolean`);
  }
  return { domains: [...new Set(domains)], news: v.news !== false, hiring: v.hiring === true };
}

/** "$13000000" or 13000000 -> 13000000; anything else -> null. */
export function parseUsd(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Most recent round by date; rounds without a date never win. */
export function latestFunding(rounds: unknown): Funding | null {
  if (!Array.isArray(rounds)) return null;
  const dated = rounds
    .map((r) => r as { type?: unknown; amount?: unknown; date?: unknown })
    .filter((r) => typeof r.date === 'string' && !Number.isNaN(Date.parse(r.date)))
    .sort((a, b) => Date.parse(b.date as string) - Date.parse(a.date as string));
  const r = dated[0];
  if (!r) return null;
  return {
    type: typeof r.type === 'string' ? r.type : null,
    amount_usd: parseUsd(r.amount),
    date: r.date as string,
  };
}

/** Hunter returns { data: {...company} }; tolerate the gateway passing either layer. */
export function unwrap(response: unknown, key: string): Record<string, unknown> | null {
  let r = response as Record<string, unknown> | null;
  for (let depth = 0; depth < 3 && r && typeof r === 'object'; depth++) {
    if (key in r) return r;
    r = (r.data as Record<string, unknown>) ?? null;
  }
  return null;
}

export function companyFields(
  domain: string,
  response: unknown,
): Omit<Account, 'recent_news' | 'open_roles' | 'errors'> {
  const c = unwrap(response, 'name');
  if (!c || typeof c.name !== 'string') {
    return {
      domain,
      found: false,
      name: null,
      description: null,
      headcount: null,
      headcount_range: null,
      founded_year: null,
      country: null,
      city: null,
      industry_tags: [],
      tech: [],
      total_raised_usd: null,
      latest_funding: null,
      linkedin: null,
    };
  }
  const metrics = (c.metrics ?? {}) as Record<string, unknown>;
  const geo = (c.geo ?? {}) as Record<string, unknown>;
  const linkedin = (c.linkedin ?? {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    domain,
    found: true,
    name: c.name,
    description: typeof c.description === 'string' ? c.description : null,
    headcount: typeof c.headcount === 'number' ? c.headcount : null,
    headcount_range: typeof c.headcount_range === 'string' ? c.headcount_range : null,
    founded_year: typeof c.foundedYear === 'number' ? c.foundedYear : null,
    country: typeof geo.country === 'string' ? geo.country : null,
    city: typeof geo.city === 'string' ? geo.city : null,
    industry_tags: strings(c.tags).slice(0, 8),
    tech: strings(c.tech),
    total_raised_usd: parseUsd(metrics.raised),
    latest_funding: latestFunding(c.fundingRounds),
    linkedin: typeof linkedin.handle === 'string' ? `https://www.linkedin.com/${linkedin.handle}` : null,
  };
}

/** Keep at most 5 results whose title or description names the company as a whole word. */
export function relevantNews(companyName: string, response: unknown): NewsItem[] {
  const body = unwrap(response, 'results');
  const results = Array.isArray(body?.results) ? (body.results as Array<Record<string, unknown>>) : [];
  const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`\\b${escaped}\\b`);
  return results
    .filter((r) => typeof r.title === 'string' && typeof r.url === 'string')
    .filter((r) => named.test(`${r.title} ${typeof r.description === 'string' ? r.description : ''}`))
    .slice(0, 5)
    .map((r) => ({
      title: r.title as string,
      url: r.url as string,
      date: typeof r.page_age === 'string' ? r.page_age : null,
      source:
        typeof (r.meta_url as Record<string, unknown>)?.hostname === 'string'
          ? ((r.meta_url as Record<string, unknown>).hostname as string)
          : null,
    }));
}

export function openRoles(response: unknown): { count: number; titles: string[] } {
  const body = unwrap(response, 'organization_job_postings');
  const jobs = Array.isArray(body?.organization_job_postings)
    ? (body.organization_job_postings as Array<Record<string, unknown>>)
    : [];
  const total = (body?.pagination as Record<string, unknown>)?.total_entries;
  return {
    count: typeof total === 'number' ? total : jobs.length,
    titles: jobs
      .map((j) => j.title)
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 10),
  };
}

export function parseOutput(value: unknown): { accounts: Account[] } {
  const accounts = (value as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts)) fail('output must contain accounts');
  for (const a of accounts as Account[]) {
    if (!a.found && (a.name || a.latest_funding || a.headcount)) fail('unfound accounts must be empty');
  }
  return { accounts: accounts as Account[] };
}
