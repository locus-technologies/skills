import { companyFields, latestFunding, openRoles, parseInput, parseOutput, relevantNews } from './rules.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Shaped like a real hunter/company-enrichment response (trimmed).
const hunterCompany = {
  data: {
    name: 'Linear',
    domain: 'linear.app',
    description: 'Linear is a project management tool.',
    headcount: 298,
    headcount_range: '251-1K',
    foundedYear: 2019,
    geo: { country: 'United States', city: 'San Francisco' },
    tags: ['project management', 'issue tracking'],
    tech: ['algolia', 'cloudflare'],
    metrics: { raised: 134200000 },
    linkedin: { handle: 'company/linearapp' },
    fundingRounds: [
      { amount: '$4200000', date: '2019-11-22', type: 'Seed' },
      { amount: '$82000000', date: '2025-06-10', type: 'Series C' },
      { amount: '$35000000', date: '2023-01-15', type: 'Series B' },
      { amount: '$999000000', type: 'Undated' },
    ],
  },
};

export default function runFixtures() {
  const cases: string[] = [];

  const input = parseInput({ domains: ['Linear.app', 'linear.app', ' vercel.com '] });
  assert(input.domains.length === 2 && input.domains[0] === 'linear.app', 'domains must normalize and dedupe');
  assert(input.news === true && input.hiring === false, 'news defaults on, hiring defaults off');
  let rejected = false;
  try {
    parseInput({ domains: ['linear.app'], hiring: 'yes' });
  } catch {
    rejected = true;
  }
  assert(rejected, 'non-boolean flag must be rejected');
  cases.push('input');

  const latest = latestFunding(hunterCompany.data.fundingRounds);
  assert(
    latest?.type === 'Series C' && latest.amount_usd === 82000000 && latest.date === '2025-06-10',
    'latest dated round wins',
  );
  assert(latestFunding([]) === null && latestFunding('nope') === null, 'no rounds -> null');
  cases.push('funding');

  const c = companyFields('linear.app', hunterCompany);
  assert(c.found && c.name === 'Linear' && c.headcount === 298 && c.total_raised_usd === 134200000, 'company fields');
  assert(c.linkedin === 'https://www.linkedin.com/company/linearapp' && c.city === 'San Francisco', 'linkedin and geo');
  const missing = companyFields('nowhere.example', { data: null });
  assert(!missing.found && missing.name === null && missing.latest_funding === null, 'unknown company is empty');
  cases.push('company');

  const news = relevantNews('Linear', {
    results: [
      {
        title: "Linear's new AI agent ships",
        url: 'https://a.example/1',
        page_age: '2026-10-20',
        meta_url: { hostname: 'a.example' },
      },
      { title: 'Nonlinear editing tips', url: 'https://b.example/2' },
      { title: 'Roundup', description: 'Linear raised a round', url: 'https://c.example/3' },
      { title: 'No url' },
    ],
  });
  assert(
    news.length === 2 && news[0].source === 'a.example' && news[1].url === 'https://c.example/3',
    'whole-word name filter',
  );
  cases.push('news');

  const roles = openRoles({
    organization_job_postings: [{ title: 'Staff Engineer' }, { title: 'AE' }],
    pagination: { total_entries: 14 },
  });
  assert(roles.count === 14 && roles.titles.length === 2, 'open roles');
  cases.push('hiring');

  let leaked = false;
  try {
    parseOutput({ accounts: [{ ...missing, name: 'Leaked', recent_news: null, open_roles: null, errors: [] }] });
  } catch {
    leaked = true;
  }
  assert(leaked, 'unfound account with data must be rejected');
  cases.push('output-gate');

  return { ok: true, cases };
}
