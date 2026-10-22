---
name: enrichment
description: Build B2B account lists, find the people who hold exact roles, get verified work emails, and research accounts (funding, headcount, tech stack, news, open roles) with pay-per-use Locus APIs. Use when the user wants to enrich a list of companies or people, find decision makers or their emails, qualify accounts against an ICP, or export prospects to a CRM.
license: MIT
metadata:
  author: locus
  version: "0.1.0"
  homepage: https://github.com/locus-technologies/skills
---

# Enrichment

Spreadsheet-style GTM enrichment without a seat license. You call metered Locus
APIs directly for one-off lookups and run three bundled Workflows for anything
repeatable or bigger than a handful of rows. Every call bills the user's Locus
credits (1,000 credits = $1); nothing needs a provider account or key.

## 1. Check the connection

Look for the Locus MCP tools. The full surface names them `search_apis`,
`describe_api`, `execute`, and `workflow_*`; the compact surface names them
`search`, `describe`, `execute`, and `workflow_*`. Either works; this file uses
the full names.

If no Locus tools exist, the user is not connected. Install and follow the
official setup skill, then come back:

```bash
npx skills add locus-technologies/locus-pro-plugin --skill locus-setup
```

Never ask the user to paste a Locus secret into the chat.

## 2. Make sure the tools are on

New Locus accounts start with every tool off. This pack uses these endpoints:

| Job | Endpoint | Credits (personal plan) |
|---|---|---|
| Company search | `hunter/discover` | 6 per search |
| People + verified emails at a domain | `hunter/domain-search` | ~12 per company |
| Firmographics, funding, tech | `hunter/company-enrichment` | 12 |
| Find one email | `hunter/email-finder` | 1-12 |
| Verify one email | `hunter/email-verifier` | 6 |
| Email fallback | `apollo/people-enrichment` | 42+ |
| Recent news | `brave/news-search` | 36 |
| Open roles (optional) | `apollo/org-enrichment` + `apollo/job-postings` | 42 + 42 |

If a call returns `ENDPOINT_DISABLED`, ask the user to open
<https://platform.paywithlocus.com/tools> and turn on the **Hunter**, **Brave
Search**, and **Apollo** providers (one switch each). Only fall back to
`request_tool_access` for a single endpoint; it is rate limited.

Free personal workspaces allow **5 paid calls per minute** (Plus allows 15).
The Workflows pace themselves, so a 30-company run on the free plan takes a few
minutes. Tell the user the estimate before starting anything over ~20 rows.

## 3. Pick the job

| The user wants | Do this |
|---|---|
| A list of companies matching an ICP | [build-account-list](references/build-account-list.md) |
| The CEO / VP Sales / etc. at known companies, with emails | Workflow `find-contacts` |
| Emails for people they already have names for | Workflow `waterfall-email` |
| Funding, headcount, tech, news, hiring for known companies | Workflow `account-signals`, then [research-accounts](references/research-accounts.md) |
| A ranked, CRM-ready list | [score-and-export](references/score-and-export.md) |

For 1-3 rows, calling `execute` directly is fine. For more, or anything the user
will repeat, use the Workflow.

## 4. Running a bundled Workflow

The Workflows live next to this file in `workflows/<name>/`. Each one is a
complete, reviewed source bundle with fixture tests. Install it into the user's
own Locus account once, then reuse it.

1. Read every file in `workflows/<name>/` and call
   `workflow_validate {mode: "check", source: {files: [{path, content}, ...]}}`.
   Send the files byte-for-byte. Do not edit them to make a check pass; report
   the diagnostic instead. Keep `source_digest` and `source_artifact_id`.
2. `workflow_definition {action: "list", query: "<name>"}`.
   - An active Workflow with that exact name whose `source_digest` equals the
     check's digest and that has a saved version: it is current. Skip to step 5.
   - Same name, different digest: the pack was updated. `workflow_definition
     {action: "update", workflow_id, revision: <current_revision>, source:
     {artifact_id: <source_artifact_id>}, idempotency_key: "update-<name>-<first 16 of digest>"}`,
     then `workflow_validate {mode: "check", workflow_id, revision: <new revision>}`.
   - None: `workflow_definition {action: "create", name: "<name>", source:
     {artifact_id: <source_artifact_id>}, validated_source_digest: <source_digest>,
     idempotency_key: "create-<name>-<first 16 of digest>"}`.
3. `workflow_validate {mode: "fixtures", workflow_id, revision}` must return
   `ok: true`.
4. `workflow_definition {action: "save", workflow_id, revision}`. Use the
   returned version number from here on.
5. Unless this exact version already has a successful pilot, pilot on at most 3 rows: `workflow_run {workflow_id, version, mode: "pilot", input, max_charge_credits, idempotency_key}`.
   Poll `workflow_runs {action: "get", run_id}` every few seconds until it
   finishes, then read the `result` artifact with
   `workflow_runs {action: "artifact", run_id, artifact_id}`.
6. Show the user the pilot rows and charge. Then run the full input with
   `mode: "run"` and a `max_charge_credits` ceiling from the table below.

Budget ceilings (credits per row, personal plan): `find-contacts` 130,
`waterfall-email` 80, `account-signals` 60 (+100 with `hiring: true`).
Typical spend is far lower; see the measured costs in the repo README.

### Inputs

```jsonc
// find-contacts: exact role holders and their provider-verified emails
{ "companies": [{ "domain": "linear.app" }], "roles": ["CEO", "VP of Engineering"],
  "departments": ["executive", "it"], "per_company": 20 }

// waterfall-email: known people
{ "people": [{ "full_name": "Karri Saarinen", "domain": "linear.app" }], "apollo_fallback": true }

// account-signals: known companies
{ "domains": ["linear.app", "vercel.com"], "news": true, "hiring": false }
```

Hunter departments: executive, it, finance, management, sales, legal, support,
hr, marketing, communication, education, design, health, operations.

## 5. Rules for every result

- Never invent a person, title, email, or number. A null from a Workflow stays
  null in what you show and export.
- `find-contacts` matches titles exactly. "Head of Sales" is not "VP of Sales";
  if the user wants both, pass both roles.
- Only `email` values are verified deliverable. `risky_email` (catch-all or
  unknown) must be labeled as unverified if you show or export it.
- Cite a URL for every research claim that did not come from a Workflow field.
- Write results to a CSV in the working directory and tell the user the path,
  row count, and total credits spent (sum `charged_credits` from the runs, or
  `locus/creditsCharged` from direct calls).
- Locus Workflows cannot write to other systems. To load a CRM, export the CSV
  and use the user's own CRM tool or import screen.
