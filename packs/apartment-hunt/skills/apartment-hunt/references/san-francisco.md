# San Francisco

## Sweep settings

```jsonc
{
  "city": "San Francisco", "state": "CA",
  "craigslist_site": "sfbay.craigslist.org",
  "craigslist_subarea": "sfc"   // the city itself; Craigslist search otherwise spans the whole Bay Area
}
```

Craigslist search results carry no coordinates and their `location` text is
often wrong, so Craigslist posts land in `unlocated` unless the title names one
of the requested areas. Vet an interesting one to get its location.

## Neighborhood names

These names resolve to the right Mapbox neighborhood boundary (checked
2026-11-11). Pass them as `areas` strings:

Mission, Bernal Heights, Noe Valley, Hayes Valley, Castro, Duboce Triangle,
Haight-Ashbury, Cole Valley, Western Addition, Japantown, Pacific Heights,
Lower Pacific Heights, Presidio Heights, Cow Hollow, Russian Hill, Nob Hill,
North Beach, Tenderloin, Financial District, Mission Bay, Dogpatch, Potrero
Hill, Glen Park, Excelsior, Bayview, Inner Sunset, Outer Sunset, Inner
Richmond, Outer Richmond.

Mapbox resolves these to a neighbor or a different place, so pass them as
circles. Centers and sizes come from PadMapper's neighborhood boxes:

```jsonc
{ "name": "Marina", "lat": 37.8026, "lng": -122.4369, "radius_miles": 0.6 }
{ "name": "Lower Haight", "lat": 37.7720, "lng": -122.4292, "radius_miles": 0.45 }
{ "name": "SoMa", "lat": 37.7773, "lng": -122.4054, "radius_miles": 0.9 }
```

For any other place ("near Dolores Park", "within a mile of my office"), use a
circle around the address: geocode it with `mapbox/geocode-forward` (1 credit)
and pass `{ name, lat, lng, radius_miles }`.

## What a budget gets

Run one sweep without `areas` and read `market` (city-wide median asking rent
for the bedroom count, from MLS listings) and `neighborhoods` (PadMapper's
median asking rent per neighborhood). Medians from asking prices skew toward
larger, newer buildings, so treat them as a rough guide, and say which source a
number came from.

## Rent control

San Francisco's Rent Ordinance limits yearly rent increases for most units in
buildings built on or before June 13, 1979 that are not single-family homes.
Under the state's Costa-Hawkins Act, single-family homes and condos are
generally exempt from the increase limits for tenancies that began on or after
January 1, 1996. Units built after June 13, 1979 still get the ordinance's
just-cause eviction protection, and many get the statewide Tenant Protection
Act (AB 1482) increase cap. Source: <https://www.sf.gov/learn-about-san-francisco-rental-laws>.

What this means for a listing:

- `vet-listings` reports `likely`, `unlikely`, or `unknown` from the build year
  and building type on RentCast's property record. It is an estimate, not a
  legal determination.
- RentCast's records can be wrong for San Francisco: it says 346 Leavenworth St
  was built in 1977 (the Assessor says 1924) and calls 2023 Folsom St a
  single-family home (the Assessor lists 11 units). Always confirm the build
  year and use with the city: the Assessor roll on DataSF (free, no key), or
  the Property Information Map, <https://sfplanninggis.org/pim/>. Example for
  346 Leavenworth St (street name in capitals, number padded to four digits):
  `https://data.sf.gov/resource/wv5m-vpq2.json?$select=property_location,year_property_built,use_definition,number_of_units&$where=property_location%20like%20'%25LEAVENWORTH%25'%20AND%20property_location%20like%20'%250346%25'&$order=closed_roll_year%20DESC&$limit=1`.
  Quote `year_property_built`, `use_definition`, and `number_of_units` with the
  link. A lot can cover a range of numbers ("0151 0149 CHENERY ST" is 149-151
  Chenery), and condo buildings appear one row per unit as "Single Family
  Residential" with a unit suffix in `property_location`.
- A listing that says the unit is "subject to the San Francisco Rent
  Ordinance" is describing eviction protection, which almost every unit has.
  It does not mean the rent is controlled.
- For a definitive answer, the user can ask the Rent Board:
  <https://www.sf.gov/departments/rent-board>.

## Scams seen in San Francisco listings

- A real listing's photos and address reposted at half the price, with the
  "owner" out of the country and the keys "mailed after the deposit."
- Pressure to pay a deposit or "holding fee" by Zelle, wire, or gift card
  before a showing.
- Moving the conversation to text or a personal email right away.

Any one of these is enough to stop. The user should see the unit in person (or
on a live video tour run by a verified agent) and sign a lease before paying
anything.

## Commutes

`vet-listings` times bike, walk, and drive routes with Mapbox. There is no
Muni or BART routing yet. If the user needs transit times, say so and point
them to <https://511.org/transit>; do not estimate transit times
yourself.
