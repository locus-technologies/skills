# Score and export

## Score

Scoring is pure computation on data you already have. It costs nothing.

1. Write the user's ICP as explicit rules with weights before scoring, and show
   them to the user. Example:

   | Rule | Points |
   |---|---|
   | Headcount 51-500 | 30 |
   | Raised in the last 18 months | 25 |
   | Uses a required technology | 25 |
   | Hiring for the persona we sell to | 20 |

2. Unknown values earn 0 points and are listed in a `missing` column. Never
   guess a value to complete a score.
3. Sort descending. Ties break on most recent funding date.

## Export

Write one CSV row per contact (or per account if there are no contacts). Use
these column names; HubSpot, Attio, and Salesforce imports map them without
custom fields:

| Column | From |
|---|---|
| `First Name`, `Last Name` | `find-contacts` / input |
| `Email` | `email` only (verified) |
| `Email Status` | `email_status` / `status` |
| `Job Title` | `title` |
| `LinkedIn URL` | `linkedin` |
| `Company Name` | `account-signals.name` |
| `Company Domain` | domain |
| `Employees` | `headcount` |
| `Country`, `City` | `country`, `city` |
| `Last Funding Type`, `Last Funding Date`, `Total Raised (USD)` | `latest_funding`, `total_raised_usd` |
| `Score`, `Score Notes` | your scoring |
| `Unverified Email` | `risky_email`, only if the user asked for it |

Name the file `<what>-<YYYY-MM-DD>.csv` in the working directory. Tell the user
the path, row counts (total, with verified email, missing data), and the total
credits spent on the whole job.

Locus cannot push to a CRM. If the user has a CRM tool or MCP connected, use
that to import the CSV; otherwise point them to the CRM's CSV import.
