# Research accounts

`account-signals` returns structured facts per domain. This step turns them
into a short, cited brief per account, the way a researcher would.

## Facts the Workflow gives you

- `name`, `description`, `industry_tags`, `country`, `city`, `founded_year`
- `headcount`, `headcount_range`
- `total_raised_usd`, `latest_funding` (`type`, `amount_usd`, `date`)
- `tech` (detected technologies)
- `recent_news` (up to 5, last month, each with a URL)
- `open_roles` (`count`, top titles) when run with `hiring: true`
- `errors` for any call that failed; treat those fields as unknown

## Writing the brief

For each account, 3-5 bullets, most useful first:

1. What they do, in one line, from `description`.
2. Size and stage: headcount, latest round and date, total raised.
3. Why now: a funding round in the last 12 months, hiring for roles the user
   sells to, or a relevant news item. Link the news URL.
4. Fit notes against the user's ICP, including anything unknown.

Do not pad with generic statements. If there is nothing notable, say so.

Every fact in the brief must come from a Workflow field or a source you cite
next to it. Do not add facts from memory, even well-known ones (flagship
products, open-source projects, remote policy, founders): the user cannot tell
a remembered fact from a looked-up one, and memory goes stale. Paraphrase
`description` for "what they do" instead of expanding on it.

## Going deeper on one question

When the user asks something the fields do not answer ("do they sell to
banks?", "who are their main competitors?"), use one research call instead of
guessing:

- `parallel/responses` with `{"input": "<question about <company> (<domain>)>"}`
  for a cited answer (typically ~60 credits).

Quote the answer's sources. Never present a research answer as a Workflow fact.
