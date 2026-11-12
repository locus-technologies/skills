# Contributing a skill pack

A skill pack teaches a coding agent to do one job that people otherwise pay a
SaaS seat for, using [Locus](https://paywithlocus.com) pay-per-use APIs. The
user installs it with one command, asks for what they want in plain words, and
pays per call from their Locus credits. No other accounts or API keys.

We welcome new packs and fixes to existing ones. Open an issue first if you
want to check that nobody is already building the same job.

## Pack layout

Copy [`packs/apartment-hunt`](packs/apartment-hunt) and rename it. A pack named
`<name>` (lowercase words joined by hyphens) looks like this:

```text
packs/<name>/
├── README.md                     what it does, how to install, measured cost
├── .claude-plugin/plugin.json    Claude Code plugin manifest
├── .mcp.json                     the Locus MCP server, X-Source-Name: skill-pack-<name>
├── skills/<name>/
│   ├── SKILL.md                  frontmatter (name, description, license), then the instructions
│   ├── references/*.md           guides for judgment-heavy jobs (optional)
│   └── workflows/<id>/           one folder per Workflow
│       ├── workflow.json         name, entrypoint, runtime, effects, pinned bindings
│       ├── workflow.ts
│       ├── locus.lock.json       the same bindings and contract digests
│       └── tests/rules.ts, tests/fixtures.ts
└── evals/
    ├── tasks.json                5-8 realistic tasks
    └── checks.mjs                export const checks = { <task id>: (task, run) => ({ pass, notes }) }
```

Then add the pack to `.claude-plugin/marketplace.json` and to the table in
[`README.md`](README.md).

## Rules

- **Locus only.** `.mcp.json` declares one server, `locus`. The pack must not
  ask the user for any other account, key, or paid plan.
- **Deterministic steps are Workflows.** Fan-out, merging, deduplication, and
  scoring go in a Workflow with fixture tests, so every user runs the same
  reviewed code with a hard credit ceiling. Judgment calls go in `SKILL.md` and
  `references/`.
- **Read-only Workflows.** Workflow and binding `effects` may only be
  `locus.read` and `locus.compute`. Anything that writes to the outside world
  needs a maintainer to review its design first; open an issue.
- **Pin every binding.** Copy each slug's `contract_digest` from Locus
  `describe` into both `workflow.json` and `locus.lock.json`.
- **The user stays in charge.** The agent drafts messages, applications, and
  orders; it never sends, pays, books, or applies without the user confirming.
- **Self-contained skills.** Installing a skill copies its folder alone, so
  nothing under `skills/<name>/` may link outside it (`../`).
- **Prices in the open.** List every API the pack calls in `SKILL.md` with its
  price, and tell the agent what a typical run costs before it starts one.
- **Honest evals.** Write each task's ground truth from primary sources (the
  official record, the provider's own site), never from memory. Checks assert
  results (the right rows, nothing invented, inside the budget), not which tools
  were called. Include one task with `"no_mcp": true` where the agent has no
  Locus connection and must point the user to setup without spending anything.
- **Nothing private.** No secrets, eval transcripts, personal data, or launch
  material. `evals/runs/` and `launch/` are gitignored.

## Before you open a pull request

```bash
node scripts/check-packs.mjs        # the pack format; CI runs the same check
npx @biomejs/biome@2.4.5 check .    # lint and format (add --write to fix)
```

Pilot each Workflow on your own Locus account (`workflow_validate` check and
fixtures, `workflow_definition` save, then `workflow_run` with `mode: "pilot"`)
and read the result, not just the status.

## What happens next

1. **CI.** For contributors outside the Locus org, CI waits until Wes or Cole
   approves the run. It never has access to secrets.
2. **Review.** A maintainer reads the pack and pilots its Workflows.
3. **Evals.** We run your evals against real agents on Locus stage, check each
   failure against the transcript, and put the measured results and costs in the
   pack's README.
4. **Merge.** Wes or Cole approves and merges. We may ask for changes, or
   decline a pack that overlaps an existing one or needs APIs Locus doesn't have
   yet (tell us which; we may add them).

By contributing you agree that your contribution is licensed under the
repository's [MIT license](LICENSE).
