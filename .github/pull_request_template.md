## What job does this pack do?

<!-- One or two sentences in the user's words: what they ask their agent, and what they get back. -->

## Checklist

- [ ] `node scripts/check-packs.mjs` passes
- [ ] `npx @biomejs/biome@2.4.5 check .` passes
- [ ] Every Locus API the pack calls is listed in its SKILL.md, with its price
- [ ] Deterministic steps are Workflows with fixture tests; I ran each one as a pilot on my own Locus account
- [ ] The agent never sends, pays, books, or applies for anything without the user confirming
- [ ] Eval ground truth comes from primary sources, not memory
- [ ] No secrets, eval transcripts, or personal data are committed

## Runs on my account

<!-- Optional: paste a pilot's result summary (run id, rows, credits charged). Maintainers rerun the evals on Locus stage before merging. -->
