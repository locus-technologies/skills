# Apartment Hunt

Search Craigslist, Zillow, PadMapper, Rent.com and MLS listings at once from
your coding agent, see only what's new each time, and check the shortlist for
scams, fair price, San Francisco rent control, and your bike, walk, or drive
commute. Billed per call to your Locus credits.

```bash
npx skills add locus-technologies/skills --skill apartment-hunt
```

## What's inside

| Workflow | Does | Providers |
|---|---|---|
| `sweep-listings` | One pass over five rental sources for a city: filters by bedrooms, price, and neighborhoods (Mapbox boundaries), merges the same unit listed on several sites, drops listings you've already seen, and returns the city's median asking rent. | RentCast, Craigslist, PadMapper, Rent.com, Zillow, Mapbox |
| `vet-listings` | For each listing on a shortlist: the full Craigslist post, price against RentCast's market estimate, rental-scam signals, a San Francisco rent-control first pass, and commute times. | Craigslist, RentCast, Mapbox |

Plus guides for San Francisco (neighborhoods, rent control and how to confirm
it with the city's records, local scams), a daily watch, and writing to
landlords. The agent drafts; it never sends messages or pays anything.

No transit routing yet: commutes are bike, walk, and drive.

## Measured on real runs

Claude Code (Claude Opus 5.5) running the [evals](evals) on a fresh project
with only this pack installed, 2026-11-11. 1,000 credits = $1.

| Asked for | Result | Credits | Time |
|---|---|---|---|
| 1BR up to $3,800 in the Mission, Bernal Heights, or Noe Valley | All five sources searched: 15 listings, all in budget and area, units listed on two sites merged into one row | 549 | 4 min |
| The same search the next morning | Only listings not seen before | 549 | 4 min |
| The whole hunt: search, check, shortlist | 5-listing shortlist with market rent, scam risk, rent control, and bike time | 850 | 7 min |
| Rank 5 listings by bike time to an office | Every time matches a Mapbox route | 30 | 4 min |
| Is this building rent controlled? (4 addresses) | All four match the city's Assessor roll | 0 | 36 s |
| A message to a landlord | Drafted, not sent; no payment before a viewing | 30 | 48 s |
| No Locus connection | Points to setup, spends nothing | 0 | 12 s |

An obviously fake ad pasted on its own ("overseas, wire the deposit") was called
a scam every time, but the agent answered from its own knowledge without this
pack, and twice out of three it quoted Hayes Valley rents from memory. Ask it to
vet the listing to get the real market rent.

## Turn on these tools

If any of these are off in your Locus account, turn on **RentCast**, **Craigslist**,
**PadMapper**, **Rent.com**, **Zillow**, and **Mapbox** at
[platform.paywithlocus.com/tools](https://platform.paywithlocus.com/tools).
