# Enrichment

Build account lists, find the people who hold exact roles, get verified work
emails, and research accounts, from your coding agent, billed per call to your
Locus credits.

```bash
npx skills add locus-technologies/skills --skill enrichment
```

## What's inside

| Workflow | Does | Providers |
|---|---|---|
| `find-contacts` | Exact role holders at a list of domains, with provider-verified emails. "Head of Sales" never passes for "VP of Sales". | Hunter domain search |
| `waterfall-email` | Verified work emails for people you already have names for. Hunter finder → Hunter verifier → Apollo fallback (re-verified). Only verified addresses land in `email`. | Hunter, Apollo |
| `account-signals` | Headcount, funding, total raised, tech stack, last month's news, and optionally open roles, per domain. | Hunter, Brave News, Apollo |

Plus guides for building an ICP list, writing cited account briefs, and
exporting a CRM-ready CSV.

## Measured on real runs

Claude Code, personal-plan prices, 2026-10-22. Every task below passed its
checks in [`evals/checks.mjs`](evals/checks.mjs).

| Task | Result | Cost | Time |
|---|---|---|---|
| CEO + verified email at 8 companies | 6 found (incl. a co-CEO), 2 left blank, 0 wrong | $0.11 | 3 min |
| VP of Sales at 5 companies, no substitutes | 2 exact matches, 3 blank, no substituted titles | $0.15 | 2 min |
| Verified emails for 8 people (2 made up) | 6/6 real found and verified, 0 invented | $0.20 | 5 min |
| Cited briefs for 5 accounts | Every fact traced to a tool result or cited URL | $0.31 | 4 min |
| 15 US B2B companies, 51-200 people, using Stripe | 15 accounts, every headcount from provider data | $0.45 | 10 min |
| No Locus connection | Pointed to setup, spent nothing | $0.00 | <1 min |

Free Locus workspaces allow 5 paid calls per minute; the Workflows pace
themselves, so bigger lists take longer, not more money.

## Turn on these tools

New Locus accounts start with tools off. Turn on **Hunter**, **Brave Search**,
and **Apollo** at [platform.paywithlocus.com/tools](https://platform.paywithlocus.com/tools).
