import { defineWorkflow, type WorkflowRowContext } from '@withlocus/workflows';
import {
  apolloFound,
  displayName,
  finalize,
  hunterFound,
  hunterVerified,
  type Input,
  nameParts,
  parseInput,
  parseOutput,
  type Result,
  type Status,
} from './tests/rules.ts';

// Work-email waterfall for known people: Hunter finder, then Hunter verifier for
// anything the finder could not confirm, then Apollo enrichment (verified again)
// when Hunter has nothing deliverable. Only verifier-confirmed addresses land in
// `email`; catch-all or unknown addresses are returned as `risky_email`.

type Candidate = { email: string | null; status: Status; source: 'hunter' | 'apollo' | null };
const rank: Record<Status, number> = { valid: 4, accept_all: 3, unknown: 2, invalid: 1, not_found: 0 };
const better = (a: Candidate, b: Candidate) => (rank[b.status] > rank[a.status] ? b : a);

// The workspace allows a fixed number of paid calls per minute (5 on the free
// plan). The gateway waits up to 45s for a slot; past that a call fails without
// a charge. Retrying under a new occurrence waits for the next slot.
async function callWithRetry<T>(
  row: WorkflowRowContext,
  binding: string,
  step: string,
  args: Record<string, unknown>,
  maxChargeCredits: string,
): Promise<T> {
  for (let occurrence = 0; ; occurrence++) {
    try {
      return await row.call<T>(binding, step, args, { maxChargeCredits, occurrence });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (occurrence >= 3 || !/capability returned an error|429|rate limit/i.test(message)) throw error;
    }
  }
}

export default defineWorkflow<Input, { results: Result[] }>({
  input: { parse: parseInput },
  output: { parse: parseOutput },
  async run(ctx, input) {
    const results = await ctx.mapRows('people', input.people, {
      key: (p) => p.id,
      concurrency: 1,
      async run(row, person): Promise<Result> {
        const steps: string[] = [];
        const base = { id: person.id, domain: person.domain, name: displayName(person), steps };
        let best: Candidate = { email: null, status: 'not_found', source: null };
        const verify = async (email: string, step: string) => {
          steps.push(step);
          return hunterVerified(await callWithRetry(row, 'verify', step, { email }, '8'));
        };
        try {
          steps.push('hunter-find');
          const found = hunterFound(
            await callWithRetry(
              row,
              'find',
              'hunter-find',
              {
                domain: person.domain,
                ...(person.full_name
                  ? { full_name: person.full_name }
                  : { first_name: person.first_name, last_name: person.last_name }),
                max_duration: 10,
              },
              '15',
            ),
          );
          best = { ...found, source: 'hunter' };
          if (found.email && (found.status === 'accept_all' || found.status === 'unknown')) {
            best = better(best, {
              email: found.email,
              status: await verify(found.email, 'hunter-verify'),
              source: 'hunter',
            });
          }

          const parts = nameParts(person);
          if (best.status !== 'valid' && input.apollo_fallback && parts) {
            steps.push('apollo-enrich');
            const apollo = apolloFound(
              await callWithRetry(row, 'apollo', 'apollo-enrich', { ...parts, domain: person.domain }, '50'),
            );
            if (apollo.email && apollo.email !== best.email) {
              best = better(best, {
                email: apollo.email,
                status: await verify(apollo.email, 'apollo-verify'),
                source: 'apollo',
              });
            }
          }
          return finalize(base, best);
        } catch (e) {
          return { ...finalize(base, best), error: e instanceof Error ? e.message : String(e) };
        }
      },
    });
    return { results };
  },
});
