import { defineWorkflow } from '@withlocus/workflows';
import {
  type Area,
  areaFromGeocode,
  areaZips,
  finish,
  type Input,
  type Listing,
  normalize,
  type Output,
  PRICE_CREDITS,
  padmapperMedians,
  parseInput,
  parseOutput,
  type Site,
  type SiteRequest,
  type SiteStat,
  siteRequests,
  zillowRequests,
} from './tests/rules.ts';

// Sweep the rental sites for one city: RentCast (MLS), Craigslist, PadMapper,
// Rent.com and Zillow. Normalize every listing, keep only the requested bedroom
// counts, price range and areas, merge the same unit seen on several sites, and
// drop listings already seen on an earlier run.
//
// Every call is a run-level step, not a row: a pilot allows only 10 rows, and a
// sweep with several areas and pages makes more calls than that.

// The workspace allows a fixed number of paid calls per minute (5 on the free
// plan). The gateway waits up to 45s for a slot; past that a call fails without
// a charge. Retrying under a new occurrence waits for the next slot.
async function withRetry<T>(attempt: (occurrence: number) => Promise<T>): Promise<T> {
  for (let occurrence = 0; ; occurrence++) {
    try {
      return await attempt(occurrence);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (occurrence >= 3 || !/capability returned an error|429|rate limit/i.test(message)) throw error;
    }
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default defineWorkflow<Input, Output>({
  input: { parse: parseInput },
  output: { parse: parseOutput },
  async run(ctx, input) {
    const call = <T>(binding: string, step: string, args: Record<string, unknown>, max: string) =>
      withRetry((occurrence) => ctx.call<T>(binding, step, args, { maxChargeCredits: max, occurrence }));

    // 1. Resolve area names to Mapbox boundary boxes (1 credit each).
    const resolved: Array<Area | { name: string; error: string }> = [];
    const named = input.areas.filter((a): a is string => typeof a === 'string');
    for (const [i, name] of named.entries()) {
      try {
        const body = await call(
          'geocode',
          `geocode-area-${i + 1}`,
          {
            q: `${name}, ${input.city}, ${input.state}`,
            types: 'neighborhood,locality,place',
            limit: 1,
            country: 'us',
          },
          '2',
        );
        const area = areaFromGeocode(name, body, input.city);
        resolved.push('error' in area ? { name, error: area.error } : area);
      } catch (e) {
        resolved.push({ name, error: message(e) });
      }
    }
    const circles = input.areas.filter((a): a is Area => typeof a !== 'string');
    const areas: Area[] = [...resolved.filter((a): a is Area => !('error' in a)), ...circles];
    const searchedAreas = [
      ...resolved.map((a) =>
        'error' in a
          ? { name: a.name, matched: null, error: a.error }
          : { name: a.name, matched: a.matched ?? a.name, bbox: a.bbox },
      ),
      ...circles.map((a) => ({ name: a.name, matched: a.name, lat: a.lat, lng: a.lng, radius_miles: a.radius_miles })),
    ];

    // 2. One call per site and page. A failing site is reported, not fatal.
    type Page = { site: Site; location?: string; rows: Listing[]; medians: Output['neighborhoods']; error?: string };
    const fetchPages = async (requests: SiteRequest[], prefix: string): Promise<Page[]> => {
      const out: Page[] = [];
      for (const [i, req] of requests.entries()) {
        try {
          const body = await call(req.site, `${prefix}-${i + 1}`, req.args, PRICE_CREDITS[req.site]);
          out.push({
            site: req.site,
            location: req.location,
            rows: normalize(req.site, body, input),
            medians: req.site === 'padmapper' && req.page === 1 ? padmapperMedians(body) : [],
          });
        } catch (e) {
          out.push({
            site: req.site,
            location: req.location,
            rows: [],
            medians: [],
            error: `${req.location ?? `page ${req.page}`}: ${message(e)}`,
          });
        }
      }
      return out;
    };
    const first = await fetchPages(siteRequests(input), 'search');

    // 3. With areas, search Zillow by the ZIP codes the other sites found inside them.
    const zips = input.areas.length
      ? areaZips(
          first.flatMap((p) => p.rows),
          areas,
          input.zillow_max_searches,
        )
      : [];
    const zillowAt = input.areas.length ? (zips.length ? zips : [`${input.city}, ${input.state}`]) : [];
    const pages = [...first, ...(await fetchPages(zillowRequests(input, zillowAt), 'zillow'))];

    const sites: Partial<Record<Site, SiteStat>> = {};
    for (const p of pages) {
      sites[p.site] ??= { calls: 0, listings: 0, errors: [] };
      const s = sites[p.site] as SiteStat;
      s.calls++;
      s.listings += p.rows.length;
      if (p.location && !s.locations?.includes(p.location)) s.locations = [...(s.locations ?? []), p.location];
      if (p.error) s.errors.push(p.error);
    }
    return finish(
      input,
      areas,
      pages.flatMap((p) => p.rows),
      pages.flatMap((p) => p.medians),
      searchedAreas,
      sites,
    );
  },
});
