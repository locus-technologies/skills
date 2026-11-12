---
name: apartment-hunt
description: Rental apartment search and listing checks. Load it before answering about any rental listing, even one that is obviously a scam or overpriced, because it looks up the real market rent for that address instead of guessing. Sweeps Craigslist, Zillow, PadMapper, Rent.com and MLS listings (RentCast) with pay-per-use Locus APIs, returns only new listings on repeat runs, and checks listings for scam signals, San Francisco rent control, and bike, walk, or drive commute time. Use when the user is looking for an apartment or rental, wants daily listing alerts, pastes or links a listing and asks if it is legit, a scam, fairly priced, or rent controlled, wants listings ranked by commute, or wants help contacting a landlord.
license: MIT
metadata:
  author: locus
  version: "0.1.0"
  homepage: https://github.com/locus-technologies/skills
---

# Apartment hunt

Search every major rental site at once, keep only what is new, and check the
shortlist before the user spends a Saturday on viewings. Every call bills the
user's Locus credits (1,000 credits = $1); nothing needs a provider account or
key. Tuned for San Francisco ([san-francisco.md](references/san-francisco.md));
the sweep and vetting work in any US city, but rent-control rules exist only for
San Francisco.

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

Tools can be turned off per account. This pack uses:

| Job | Endpoint | Credits |
|---|---|---|
| MLS rental listings (and the city's median rent) | `rentcast/rental-listings` | 36 |
| Craigslist search / one post | `craigslist/search-listings` / `craigslist/get-listing-detail` | 60 / 30 |
| PadMapper search (and neighborhood medians) | `padmapper/search-listings` | 60 |
| Rent.com search | `rent/search-listings` | 30 |
| Zillow rentals | `zillow/search-homes-for-rent` | 90 |
| Market rent estimate | `rentcast/rent-estimate` | 36 |
| Build year and type | `rentcast/properties` | 36 |
| Neighborhood and address lookup | `mapbox/geocode-forward` | 1 |
| Bike, walk, drive time | `mapbox/directions` | 2.4 |

If a call returns `ENDPOINT_DISABLED`, ask the user to open
<https://platform.paywithlocus.com/tools> and turn on **RentCast**, **Craigslist**,
**PadMapper**, **Rent.com**, **Zillow**, and **Mapbox**. If one of them is not
listed there, call `request_tool_access` for each disabled slug and give the user
the approval links. It is rate limited, so ask once per slug.

Free personal workspaces allow **5 paid calls per minute** (Plus allows 15). The
Workflows pace themselves: a sweep takes two to three minutes, vetting takes
about a minute per listing on the free plan. Say so before starting.

## 3. Pick the job

| The user wants | Do this |
|---|---|
| Listings matching their budget, size, and neighborhoods | Workflow `sweep-listings` |
| A daily or repeat search with only new listings | Workflow `sweep-listings` with `seen`; see [daily-watch](references/daily-watch.md) |
| To know if a listing is legit, a scam, fairly priced, or rent controlled | Workflow `vet-listings`, even when the answer looks obvious: the user gets the real market rent for that place, and you never quote rents from memory |
| Listings ranked by commute | Workflow `vet-listings` with `commute` |
| What their budget gets them, or which neighborhoods to look in | Run a sweep without `areas` and read `market` and `neighborhoods`; see [san-francisco](references/san-francisco.md) |
| To write to a landlord or ask for a viewing | [contact-landlord](references/contact-landlord.md) |

For one question about one listing (is this address rent controlled?), calling
`execute` directly is fine. For anything over two listings or anything the user
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
5. Run it. Locus refuses `mode: "run"` until a pilot of that exact version has
   succeeded, and a pilot handles at most 10 rows and 5 minutes. So the first
   time, use `mode: "pilot"` with the real input when it fits: a sweep always
   does; for vetting, pilot the first 3 listings. Use the pilot's result like a
   normal run, and use `mode: "run"` for everything after it:
   `workflow_run {workflow_id, version, mode, input, max_charge_credits,
   idempotency_key}`. Poll `workflow_runs {action: "get", run_id}` every few
   seconds until it finishes, then read the `result` artifact with
   `workflow_runs {action: "artifact", run_id, artifact_id}`; page it with the
   returned cursor until it ends.

Budget ceilings (`max_charge_credits`): `sweep-listings` 750 per page (400
without `areas`); `vet-listings` 120 per listing. A sweep of three San
Francisco neighborhoods costs about 550 credits ($0.55): with areas, Zillow is
searched by up to four ZIP codes (`zillow_max_searches`), because its
city-wide search shows only 500 of the city's rentals. Vetting one listing
costs about 110 credits ($0.11).

### Inputs

```jsonc
// sweep-listings
{
  "city": "San Francisco", "state": "CA",
  "beds": [1],                    // 0 = studio; [0, 1] for either
  "max_price": 3800, "min_price": 0,
  "areas": ["Mission", "Bernal Heights", "Noe Valley"],   // optional; names or circles:
  // { "name": "Near my office", "lat": 37.7942, "lng": -122.3949, "radius_miles": 1.5 }
  "craigslist_site": "sfbay.craigslist.org", "craigslist_subarea": "sfc",  // see the city reference
  "seen": [],                     // keys from earlier runs; only new listings come back
  "pages": 1,                     // 1-3; more pages cost more and find older listings
  "zillow_max_searches": 4        // with areas: Zillow ZIP searches, 90 credits each
}

// vet-listings: pass listings straight from a sweep, a pasted ad, or an address
{
  "city": "San Francisco", "state": "CA",
  "listings": [
    { "url": "https://sfbay.craigslist.org/sfc/apa/d/...html" },
    { "address": "346 Leavenworth St, San Francisco, CA", "beds": 1, "price": 2900 },
    { "text": "<pasted ad>", "neighborhood": "Hayes Valley", "beds": 1, "price": 950 }
  ],
  "commute": { "to": "1 Market St, San Francisco, CA", "modes": ["cycling", "walking", "driving-traffic"] }
}
```

From a sweep, pass each listing's `url`, `address`, `lat`, `lng`, `beds`,
`price`, `year_built`, and `property_type` to `vet-listings` so it skips calls
it does not need.

### Reading the sweep result

- `listings`: new listings inside the areas, cheapest first. `price_from: true`
  means the lowest unit in a building ("from $3,500"), not a specific unit.
  `sources` lists every site that had it. `area` is the requested area it is in.
- `unlocated`: Craigslist posts in the city whose search result has no
  location. Show them separately as "neighborhood not given"; vet one to get its
  location.
- `searched.areas`: any area with an `error` was not searched. Tell the user,
  and retry with the name the error suggests or a `{name, lat, lng,
  radius_miles}` circle.
- `sites`: listings per site and any errors. If a site failed, say so; never
  present a partial sweep as complete.
- `market`: median asking rent for the city from MLS listings. `flags`
  `far_below_market` marks listings to vet before anything else.
- `new_keys`: save these for the next run (see daily watch).

### Reading the vetting result

- `scam.risk` `high`: tell the user plainly it looks like a scam and why
  (`signals`). Do not draft outreach for it, and never suggest sending money.
- `market.price_ratio`: asking price divided by RentCast's estimate for that
  address or area. Under 0.6 is not believable on its own.
- `rent_control.status`: `likely`, `unlikely`, or `unknown`, with the `reason`
  and where the build year came from. It is a first pass from RentCast, whose
  build years and building types are sometimes wrong. In San Francisco, before
  you tell the user anything about rent control, confirm the build year and use
  on the city's Assessor roll (free; query in
  [san-francisco.md](references/san-francisco.md)), and report the city's
  values with the link. When the two disagree, go with the city. Without a
  city record, keep `unknown`; never upgrade it to a guess. A listing that says
  it is "subject to the Rent Ordinance" is not proof of rent control: the
  ordinance's eviction protections cover most units, but the rent-increase
  limits depend on the build year and building type.
- `commute.minutes`: Mapbox routing for each mode. There is **no transit
  routing**; say so if the user asks about Muni or BART.
- `listing_status: unavailable`: the Craigslist post could not be fetched; it
  may have been taken down.

## 5. Rules for every result

- Never invent a listing, price, address, build year, or commute time, and never
  state what rents "usually" are from memory. Market rents come from
  `vet-listings` (RentCast's estimate) or a sweep's `market` and
  `neighborhoods`. A null from a Workflow stays null.
- Link every listing you show (its `url`, or its address when there is no URL).
- Never contact a landlord, submit an application, or pay anything on the
  user's behalf. Draft; the user sends.
- Never recommend paying a deposit, holding fee, or rent before the user has
  seen the unit in person (or by live video tour with a verified agent) and
  signed a lease.
- Rent-control results are estimates from public records, not legal advice;
  point to the SF Rent Board for a definitive answer.
- When the user asks for a file, write listings to a CSV in the working
  directory with at least `site, title, address, neighborhood, beds, price,
  url, lat, lng`, and tell the user the path, row count, and credits spent
  (`charged_credits` from the runs).
