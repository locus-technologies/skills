import { defineWorkflow, type WorkflowRowContext } from '@withlocus/workflows';
import { type Contact, hunterEmails, type Input, parseInput, parseOutput, selectContacts } from './tests/rules.ts';

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

export default defineWorkflow<Input, { contacts: Contact[] }>({
  input: { parse: parseInput },
  output: { parse: parseOutput },
  async run(ctx, input) {
    const rows = await ctx.mapRows('companies', input.companies, {
      key: (c) => c.domain,
      concurrency: 1,
      async run(row, company) {
        try {
          const response = await callWithRetry(
            row,
            'domainSearch',
            'domain-search',
            {
              domain: company.domain,
              type: 'personal',
              limit: input.per_company,
              ...(input.departments?.length ? { department: input.departments.join(',') } : {}),
            },
            '130',
          );
          return selectContacts(company.domain, input.roles, hunterEmails(response));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return selectContacts(company.domain, input.roles, []).map((c) => ({ ...c, error: message }));
        }
      },
    });
    return { contacts: rows.flat() };
  },
});
