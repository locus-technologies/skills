# Build an account list

Turn an ICP into a list of company domains, then qualify it with
`account-signals`.

## 1. Pin down the ICP

Get these from the user before spending anything. Ask only for what is missing.

- Industry or product category (free text is fine: "B2B payments infrastructure")
- Headcount range
- Headquarters location (country, state, or city)
- Technology used, if it matters ("uses Stripe", "on Snowflake")
- How many accounts they want
- Exclusions (existing customers, competitors, a domain list)

## 2. Search

`hunter/discover` (6 credits per search; raise `limit` for more results) is the
default. One call per distinct filter combination. In eval runs it applied
location, headcount, and technology reliably only when they were also written
into `query`, so put them in both places:

```json
{
  "query": "B2B payments infrastructure companies in the United States with 51-200 employees using Stripe",
  "headquarters_location": "United States",
  "headcount": "51-200",
  "technology": "stripe",
  "limit": 50
}
```

Other useful filters: `industry`, `keywords`, `company_type` (`public`,
`private`, `nonprofit`), and `similar_to: "<domain>"` for lookalikes of a best
customer. Page with `offset`.

Use `apollo/org-search` (42 credits per page of up to 100) only when Hunter
returns too few results. It filters by `organization_locations`,
`q_organization_keyword_tags`, and `organization_num_employees_ranges`
(`"51,200"`).

## 3. Clean the list

- Dedupe by domain (lowercase, no `www.`).
- Drop the user's exclusions.
- Keep the provider's name, domain, and any filter evidence it returned.

## 4. Qualify

Search filters are recall hints, not proof. Run `account-signals` on the
candidate domains and drop any account whose headcount, location, or funding
contradicts the ICP. Keep accounts with unknown values but mark them unknown;
missing evidence is not a match.

Report: how many candidates came back, how many survived qualification and why
the rest were dropped, and the total credits spent.
