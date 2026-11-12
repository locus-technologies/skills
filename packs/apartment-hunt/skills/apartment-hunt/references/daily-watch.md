# Daily watch

Locus Workflows cannot schedule themselves. The watch is a small file in the
user's working directory plus whatever scheduler their agent has.

## The watch file

Keep one file, `apartment-watch.json`, next to the user's work:

```jsonc
{
  "search": {                       // the sweep-listings input, minus "seen"
    "city": "San Francisco", "state": "CA", "beds": [1], "max_price": 3800,
    "areas": ["Mission", "Bernal Heights", "Noe Valley"],
    "craigslist_site": "sfbay.craigslist.org", "craigslist_subarea": "sfc"
  },
  "seen": ["addr:2023 folsom st|1", "craigslist:7998649947|1"],
  "runs": [{ "at": "2026-11-11T08:00:00Z", "new": 15, "credits": 459 }]
}
```

## Each run

1. Read the file. Run `sweep-listings` with `{ ...search, seen }`.
2. Show only `listings` and `unlocated` from the result: they are new since the
   last run. If both are empty, say "nothing new" and stop.
3. Append the result's `new_keys` to `seen` (keep the last 5,000) and add a
   `runs` entry with the run's `charged_credits`.
4. Offer to vet anything flagged `far_below_market` or that the user likes.

If a run fails part way, do not update `seen`: the next run then shows those
listings again instead of losing them.

## Scheduling

Use the agent's own scheduler if it has one (for example a Claude Code
scheduled task or Codex automation), or a cron job that starts the agent
headless with a prompt like "Run my apartment watch and tell me what's new."
New listings go fast in San Francisco, so a morning and an evening run is
reasonable. Each run costs about $0.55 with three areas (about $0.30 without
areas); tell the user the monthly estimate before setting it up.
