import { defineWorkflow, type WorkflowRowContext } from '@withlocus/workflows';
import {
  type Account,
  companyFields,
  type Input,
  openRoles,
  parseInput,
  parseOutput,
  relevantNews,
  unwrap,
} from './tests/rules.ts';

// Firmographics, funding, tech stack, recent news, and (optionally) open roles
// for a list of company domains. One account per domain; a domain the provider
// does not know comes back as found: false with every field empty.

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

export default defineWorkflow<Input, { accounts: Account[] }>({
  input: { parse: parseInput },
  output: { parse: parseOutput },
  async run(ctx, input) {
    const accounts = await ctx.mapRows('accounts', input.domains, {
      key: (domain) => domain,
      concurrency: 1,
      async run(row, domain): Promise<Account> {
        const errors: string[] = [];
        const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

        let company: unknown = null;
        try {
          company = await callWithRetry(row, 'companyEnrich', 'company', { domain }, '15');
        } catch (e) {
          errors.push(`company: ${message(e)}`);
        }
        const account: Account = { ...companyFields(domain, company), recent_news: null, open_roles: null, errors };
        if (!account.found || !account.name) return account;

        if (input.news) {
          try {
            // A bare name like "Linear" matches unrelated stories; the first industry tag anchors it.
            const q = [`"${account.name}"`, account.industry_tags[0]].filter(Boolean).join(' ');
            const news = await callWithRetry(row, 'newsSearch', 'news', { q, count: 20, freshness: 'pm' }, '40');
            account.recent_news = relevantNews(account.name, news);
          } catch (e) {
            errors.push(`news: ${message(e)}`);
          }
        }

        if (input.hiring) {
          try {
            const org = unwrap(await callWithRetry(row, 'apolloOrg', 'apollo-org', { domain }, '50'), 'organization');
            const orgId = (org?.organization as Record<string, unknown> | undefined)?.id;
            if (typeof orgId === 'string') {
              const jobs = await callWithRetry(
                row,
                'jobPostings',
                'jobs',
                { organization_id: orgId, page: 1, per_page: 25 },
                '50',
              );
              account.open_roles = openRoles(jobs);
            } else {
              errors.push('hiring: organization not found');
            }
          } catch (e) {
            errors.push(`hiring: ${message(e)}`);
          }
        }
        return account;
      },
    });
    return { accounts };
  },
});
