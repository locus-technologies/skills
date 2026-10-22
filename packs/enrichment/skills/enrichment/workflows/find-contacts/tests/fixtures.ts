import { parseInput, parseOutput, selectContacts, titleMatchesRole } from './rules.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export default function runFixtures() {
  const cases: string[] = [];

  // Exact-role gate: qualifying forms.
  for (const [title, role] of [
    ['CEO', 'CEO'],
    ['Chief Executive Officer', 'CEO'],
    ['Co-Founder & CEO', 'CEO'],
    ['Founder / Chief Executive Officer', 'CEO'],
    ['Co-CEO', 'CEO'],
    ['Co-Chief Executive Officer', 'CEO'],
    ['VP of Sales', 'VP Sales'],
    ['Vice President, Sales', 'VP of Sales'],
    ['VP Engineering', 'VP of Engineering'],
  ]) {
    assert(titleMatchesRole(title, role), `${title} must match ${role}`);
  }
  cases.push('qualifying-titles');

  // Exact-role gate: misleading forms that must never match.
  for (const [title, role] of [
    ['Executive Assistant to the CEO', 'CEO'],
    ['Office of the CEO', 'CEO'],
    ['Co-Founder', 'CEO'],
    ['Head of Sales', 'VP of Sales'],
    ['VP of Merchant Sales', 'VP of Sales'],
    ['VP Sales EMEA', 'VP of Sales'],
    ['Senior Vice President of Sales', 'VP of Sales'],
    ['Engineering Manager', 'VP of Engineering'],
  ]) {
    assert(!titleMatchesRole(title, role), `${title} must not match ${role}`);
  }
  cases.push('misleading-titles');

  // Selection picks the exact holder over a higher-confidence misleading title,
  // and returns a fully null row when nobody qualifies.
  const emails = [
    {
      value: 'ea@acme.com',
      first_name: 'Pat',
      last_name: 'Lee',
      position: 'Executive Assistant to the CEO',
      confidence: 99,
      verification: { status: 'valid' },
    },
    {
      value: 'sam@acme.com',
      first_name: 'Sam',
      last_name: 'Ng',
      position: 'Co-Founder & CEO',
      confidence: 80,
      verification: { status: 'valid' },
    },
    {
      value: 'kim@acme.com',
      first_name: 'Kim',
      last_name: 'Ro',
      position: 'Head of Sales',
      confidence: 95,
      verification: { status: 'accept_all' },
    },
  ];
  const [ceo, vpSales] = selectContacts('acme.com', ['CEO', 'VP of Sales'], emails);
  assert(ceo.matched && ceo.email === 'sam@acme.com' && ceo.email_status === 'valid', 'CEO row must be Sam');
  assert(
    !vpSales.matched && vpSales.email === null && vpSales.title === null && vpSales.first_name === null,
    'VP Sales row must be null',
  );
  cases.push('selection');

  // Output gate rejects an unmatched row that leaked data.
  let leaked = false;
  try {
    parseOutput({ contacts: [{ ...vpSales, title: 'Head of Sales' }] });
  } catch {
    leaked = true;
  }
  assert(leaked, 'unmatched row with a title must be rejected');
  cases.push('output-gate');

  // Input boundary.
  const parsed = parseInput({ companies: [{ domain: ' Acme.com ' }], roles: [' CEO '] });
  assert(
    parsed.companies[0].domain === 'acme.com' && parsed.roles[0] === 'CEO' && parsed.per_company === 20,
    'input must normalize',
  );
  let rejected = false;
  try {
    parseInput({ companies: [{ domain: 'not a domain' }], roles: ['CEO'] });
  } catch {
    rejected = true;
  }
  assert(rejected, 'bad domain must be rejected');
  cases.push('input');

  return { ok: true, cases };
}
