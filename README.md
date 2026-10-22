# Locus skill packs

Skill packs that turn your coding agent into the SaaS tool you were paying a
seat for. Each pack is a set of agent skills plus reviewed, pre-tested
Workflows that run on [Locus](https://paywithlocus.com) pay-per-use APIs. No
provider accounts, no API keys, no monthly plan: you pay per call from one
credit balance.

| Pack | What it does | Typical cost |
|---|---|---|
| [enrichment](packs/enrichment) | Account lists, exact role holders, verified work emails, account research | ~$0.01 per company searched, ~$0.03 per verified email, ~$0.06-0.13 per researched account |

Costs are measured on real runs of each pack's evals; see `packs/<pack>/evals`.

## Install

You need a Locus account connected to your agent. If you don't have one yet,
the pack walks your agent through setup the first time you use it.

**Any agent** (Claude Code, Codex, Cursor, Amp, Gemini CLI, Copilot, OpenCode, and more):

```bash
npx skills add locus-technologies/skills --skill enrichment
```

**Claude Code plugin** (also configures the Locus MCP server):

```text
/plugin marketplace add locus-technologies/skills
/plugin install enrichment@locus-skills
```

**Or just tell your agent:**

> Install the enrichment skill from github.com/locus-technologies/skills and connect Locus.

## Connect Locus

Packs talk to Locus over MCP (or the Locus CLI). If your agent isn't connected:

```bash
npx skills add locus-technologies/locus-pro-plugin --skill locus-setup
```

Then ask your agent to "set up Locus". It opens a browser sign-in; no keys are
pasted anywhere. New accounts start with every tool off: turn on the providers
a pack lists at [platform.paywithlocus.com/tools](https://platform.paywithlocus.com/tools).

## How a pack works

- `SKILL.md` tells the agent which job to do and how.
- `workflows/` holds TypeScript Workflows with fixture tests. The agent
  installs them into your own Locus account (validate, fixtures, save, pilot)
  and runs them there, with a hard credit ceiling on every run.
- `evals/` holds the tasks we run against real agents before every release,
  with the checks that decide pass or fail.

## License

MIT
