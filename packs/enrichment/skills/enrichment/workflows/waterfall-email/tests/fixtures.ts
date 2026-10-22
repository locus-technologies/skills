import { apolloFound, finalize, hunterFound, hunterVerified, nameParts, parseInput, parseOutput } from './rules.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export default function runFixtures() {
  const cases: string[] = [];

  const input = parseInput({
    people: [
      { full_name: 'Karri Saarinen', domain: 'Linear.app' },
      { first_name: 'Guillermo', last_name: 'Rauch', domain: 'vercel.com', id: 'g1' },
    ],
  });
  assert(
    input.people[0].id === 'karri saarinen@linear.app' && input.people[0].domain === 'linear.app',
    'default id and domain',
  );
  assert(input.apollo_fallback === true, 'apollo fallback defaults on');
  for (const bad of [
    { people: [{ first_name: 'Only', domain: 'a.com' }] },
    { people: [{ full_name: 'A B', domain: 'nope' }] },
  ]) {
    let rejected = false;
    try {
      parseInput(bad);
    } catch {
      rejected = true;
    }
    assert(rejected, `must reject ${JSON.stringify(bad)}`);
  }
  cases.push('input');

  assert(
    JSON.stringify(nameParts({ id: 'x', full_name: 'Mary Ann van Dyke', domain: 'a.com' })) ===
      '{"first_name":"Mary","last_name":"Dyke"}',
    'name split',
  );
  assert(nameParts({ id: 'x', full_name: 'Cher', domain: 'a.com' }) === null, 'single name cannot go to Apollo');
  cases.push('names');

  // Shapes from real provider responses (trimmed).
  const finder = hunterFound({ data: { email: 'KS@linear.app', verification: { status: 'valid' } } });
  assert(finder.email === 'ks@linear.app' && finder.status === 'valid', 'hunter finder');
  assert(hunterFound({ data: { email: null } }).status === 'not_found', 'hunter not found');
  assert(hunterVerified({ data: { status: 'accept_all', result: 'risky' } }) === 'accept_all', 'hunter verifier');
  assert(
    apolloFound({ person: { email: 'g@vercel.com', email_status: 'verified' } }).status === 'valid',
    'apollo verified',
  );
  assert(
    apolloFound({ person: { email: 'email_not_unlocked@domain.com', email_status: 'unavailable' } }).status ===
      'unknown',
    'apollo locked',
  );
  cases.push('parsers');

  // Quality gate: only valid goes to email; risky is kept separately; invalid is dropped.
  const base = { id: 'p', domain: 'a.com', name: 'P Q', steps: [] };
  const valid = finalize(base, { email: 'p@a.com', status: 'valid', source: 'hunter' });
  const risky = finalize(base, { email: 'p@a.com', status: 'accept_all', source: 'hunter' });
  const invalid = finalize(base, { email: 'p@a.com', status: 'invalid', source: 'apollo' });
  const none = finalize(base, { email: null, status: 'not_found', source: null });
  assert(valid.email === 'p@a.com' && valid.risky_email === null, 'valid -> email');
  assert(
    risky.email === null && risky.risky_email === 'p@a.com' && risky.status === 'accept_all',
    'accept_all -> risky',
  );
  assert(invalid.email === null && invalid.risky_email === null && invalid.source === null, 'invalid -> nothing');
  assert(none.status === 'not_found' && none.email === null, 'not found');
  let leaked = false;
  try {
    parseOutput({ results: [{ ...risky, email: 'p@a.com' }] });
  } catch {
    leaked = true;
  }
  assert(leaked, 'output gate rejects an unverified email');
  cases.push('quality-gate');

  return { ok: true, cases };
}
