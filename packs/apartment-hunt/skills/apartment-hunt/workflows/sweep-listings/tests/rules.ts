// Pure rules for sweep-listings. They live under tests/ so both the entrypoint
// (./tests/rules.ts) and tests/fixtures.ts (./rules.ts) can import them without a
// parent-directory path, which the Locus API firewall rejects.

export type Site = 'rentcast' | 'craigslist' | 'padmapper' | 'rent' | 'zillow';
export const SITES: Site[] = ['rentcast', 'craigslist', 'padmapper', 'rent', 'zillow'];

export type BBox = [number, number, number, number]; // minLng, minLat, maxLng, maxLat

export interface Area {
  name: string;
  /** From Mapbox when the area was given by name. */
  bbox?: BBox;
  /** A circle, for "within 2 miles of my office". */
  lat?: number;
  lng?: number;
  radius_miles?: number;
  /** The place Mapbox matched, such as "Mission District" for "Mission". */
  matched?: string;
  /** The ZIP code at the area's center, from Mapbox. */
  zip?: string;
  /** Extra words that name this area in listing titles (Craigslist has no coordinates). */
  aliases: string[];
}

export interface Input {
  city: string;
  state: string;
  beds: number[];
  min_price: number;
  max_price: number;
  /** Area names to geocode, or explicit circles. Empty means the whole city. */
  areas: Array<string | Area>;
  sites: Site[];
  craigslist_site: string | null;
  craigslist_subarea: string | null;
  craigslist_query: string;
  pages: number;
  /** With areas, Zillow is searched by the ZIP codes found inside them, up to this many. */
  zillow_max_searches: number;
  seen: string[];
  max_results: number;
}

export interface Listing {
  key: string;
  site: Site;
  id: string;
  title: string;
  address: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  beds: number;
  baths: number | null;
  price: number;
  /** True when the price is the lowest unit in a building ("from $3,500"). */
  price_from: boolean;
  sqft: number | null;
  url: string | null;
  posted: string | null;
  days_on_market: number | null;
  year_built: number | null;
  property_type: string | null;
}

export interface OutListing extends Omit<Listing, 'site' | 'id'> {
  area: string | null;
  sources: Array<{ site: Site; url: string | null; price: number }>;
  flags: string[];
}

export interface SiteStat {
  calls: number;
  /** In-city listings this site returned, before the budget, bedroom and area filters. */
  listings: number;
  /** Where the site was searched, when not the whole city (Zillow ZIP codes). */
  locations?: string[];
  errors: string[];
}

export interface Output {
  searched: {
    city: string;
    state: string;
    beds: number[];
    min_price: number;
    max_price: number;
    areas: Array<{
      name: string;
      matched: string | null;
      bbox?: BBox;
      lat?: number;
      lng?: number;
      radius_miles?: number;
      error?: string;
    }>;
  };
  sites: Partial<Record<Site, SiteStat>>;
  /** Median asking rent per bedroom count of active RentCast listings in the whole city, at any price. */
  market: Array<{ beds: number; median_price: number; listings: number }>;
  /** PadMapper's neighborhood median asking rents for the requested bedroom counts. */
  neighborhoods: Array<{ neighborhood: string; beds: number; median_price: number }>;
  listings: OutListing[];
  /** Craigslist listings in the city with no coordinates and no area named in the title. */
  unlocated: OutListing[];
  already_seen: number;
  new_keys: string[];
  truncated: boolean;
}

const STATES: Record<string, string> = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DE: 'delaware',
  DC: 'district-of-columbia',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  IA: 'iowa',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  ME: 'maine',
  MD: 'maryland',
  MA: 'massachusetts',
  MI: 'michigan',
  MN: 'minnesota',
  MS: 'mississippi',
  MO: 'missouri',
  MT: 'montana',
  NE: 'nebraska',
  NV: 'nevada',
  NH: 'new-hampshire',
  NJ: 'new-jersey',
  NM: 'new-mexico',
  NY: 'new-york',
  NC: 'north-carolina',
  ND: 'north-dakota',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode-island',
  SC: 'south-carolina',
  SD: 'south-dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VT: 'vermont',
  VA: 'virginia',
  WA: 'washington',
  WV: 'west-virginia',
  WI: 'wisconsin',
  WY: 'wyoming',
};

function fail(message: string): never {
  throw new Error(message);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const int = (v: unknown, name: string, min: number, max: number, fallback?: number): number => {
  if (v === undefined || v === null) {
    if (fallback === undefined) fail(`${name} is required`);
    return fallback;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    fail(`${name} must be an integer from ${min} to ${max}`);
  return v;
};

export function parseInput(value: unknown): Input {
  if (!value || typeof value !== 'object') fail('input must be an object');
  const v = value as Record<string, unknown>;
  const city = typeof v.city === 'string' ? v.city.trim() : '';
  if (!city || city.length > 60) fail('city is required');
  const state = typeof v.state === 'string' ? v.state.trim().toUpperCase() : '';
  if (!STATES[state]) fail('state must be a 2-letter US state code');

  const beds = Array.isArray(v.beds) ? v.beds : fail('beds must be an array like [1] (0 = studio)');
  if (beds.length === 0 || beds.length > 6) fail('beds must list 1-6 bedroom counts');
  for (const [i, b] of beds.entries()) int(b, `beds[${i}]`, 0, 6);

  const max_price = int(v.max_price, 'max_price', 300, 100000);
  const min_price = int(v.min_price, 'min_price', 0, max_price, 0);

  const rawAreas = v.areas === undefined ? [] : Array.isArray(v.areas) ? v.areas : fail('areas must be an array');
  if (rawAreas.length > 12) fail('at most 12 areas');
  const areas = rawAreas.map((a, i): string | Area => {
    if (typeof a === 'string' && a.trim()) return a.trim();
    const o = (a ?? {}) as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim()) fail(`areas[${i}] needs a name`);
    const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null);
    const lat = num('lat');
    const lng = num('lng');
    const radius = num('radius_miles');
    if (lat === null || lng === null || radius === null || radius <= 0 || radius > 25)
      fail(`areas[${i}] must be a name or { name, lat, lng, radius_miles }`);
    return { name: o.name.trim(), lat, lng, radius_miles: radius, aliases: [] };
  });

  const sites = v.sites === undefined ? SITES : Array.isArray(v.sites) ? v.sites : fail('sites must be an array');
  for (const s of sites) if (!SITES.includes(s as Site)) fail(`unknown site ${String(s)}; use ${SITES.join(', ')}`);

  const clSite = typeof v.craigslist_site === 'string' ? v.craigslist_site.trim().toLowerCase() : null;
  if (clSite && !/^[a-z]+\.craigslist\.org$/.test(clSite)) fail('craigslist_site must look like sfbay.craigslist.org');
  const clSub = typeof v.craigslist_subarea === 'string' ? v.craigslist_subarea.trim().toLowerCase() : null;
  if (clSub && !/^[a-z]{3}$/.test(clSub)) fail('craigslist_subarea must be a 3-letter code like sfc');

  const seen = v.seen === undefined ? [] : Array.isArray(v.seen) ? v.seen : fail('seen must be an array of keys');
  if (seen.length > 5000 || seen.some((k) => typeof k !== 'string')) fail('seen must hold at most 5000 string keys');

  return {
    city,
    state,
    beds: [...new Set(beds as number[])].sort(),
    min_price,
    max_price,
    areas,
    sites: [...new Set(sites as Site[])].filter((s) => s !== 'craigslist' || clSite),
    craigslist_site: clSite,
    craigslist_subarea: clSub,
    craigslist_query: typeof v.craigslist_query === 'string' ? v.craigslist_query.trim() : city,
    pages: int(v.pages, 'pages', 1, 3, 1),
    zillow_max_searches: int(v.zillow_max_searches, 'zillow_max_searches', 1, 6, 4),
    seen: seen as string[],
    max_results: int(v.max_results, 'max_results', 1, 300, 100),
  };
}

export type SiteRequest = { site: Site; page: number; location?: string; args: Record<string, unknown> };

/**
 * One provider call per site and page. Arguments follow each provider's own types.
 * With areas, Zillow waits for `zillowRequests`: its city-wide map stops at 500 of
 * ~3,000 San Francisco rentals, while a ZIP search covers that ZIP.
 */
export function siteRequests(input: Input): SiteRequest[] {
  const out: SiteRequest[] = [];
  const beds = input.beds;
  for (const site of input.sites) {
    if (site === 'zillow' && input.areas.length) continue;
    // RentCast returns up to 500 rows for one fixed price, so it never needs a second page.
    const pages = site === 'rentcast' ? 1 : input.pages;
    for (let page = 1; page <= pages; page++) {
      // No price filter: the unfiltered rows give the city's median asking rent per bedroom count.
      if (site === 'rentcast')
        out.push({
          site,
          page,
          args: { city: input.city, state: input.state, status: 'Active', bedrooms: beds.join('|'), limit: 500 },
        });
      if (site === 'craigslist')
        out.push({
          site,
          page,
          args: {
            site: input.craigslist_site,
            category: 'apa',
            query: input.craigslist_query,
            min_price: input.min_price,
            max_price: input.max_price,
            sort: 'date',
            limit: 100,
            offset: (page - 1) * 100,
          },
        });
      if (site === 'padmapper')
        out.push({
          site,
          page,
          args: {
            city_slug: `${slug(input.city)}-${input.state.toLowerCase()}`,
            bedrooms: beds.join(','),
            min_price: input.min_price,
            max_price: input.max_price,
            page,
          },
        });
      if (site === 'rent')
        out.push({
          site,
          page,
          args: {
            location_slug: `${STATES[input.state]}/${slug(input.city)}`,
            ...(beds.length === 1 ? { beds: String(beds[0]) } : {}),
            price_min: String(input.min_price),
            price_max: String(input.max_price),
            page,
          },
        });
      if (site === 'zillow')
        out.push(...zillowRequests(input, [`${input.city}, ${input.state}`]).filter((r) => r.page === page));
    }
  }
  return out;
}

export function zillowRequests(input: Input, locations: string[]): SiteRequest[] {
  if (!input.sites.includes('zillow')) return [];
  return locations.flatMap((location) =>
    Array.from({ length: input.pages }, (_, i) => ({
      site: 'zillow' as const,
      page: i + 1,
      location,
      args: { location, page: i + 1 },
    })),
  );
}

export const zipOf = (address: string | null) => address?.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;

/**
 * ZIP codes to search Zillow by: each area's center ZIP first, so no area goes unsearched,
 * then the ZIPs holding the most in-area listings from the other sites.
 */
export function areaZips(rows: Listing[], areas: Area[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const zip = zipOf(r.address);
    if (zip && r.lat !== null && areaFor(r, areas)) counts.set(zip, (counts.get(zip) ?? 0) + 1);
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([zip]) => zip);
  const centers = areas.map((a) => a.zip).filter((z): z is string => !!z);
  return [...new Set([...centers, ...byCount])].slice(0, max);
}

export const PRICE_CREDITS: Record<Site, string> = {
  rentcast: '45',
  craigslist: '75',
  padmapper: '75',
  rent: '40',
  zillow: '110',
};

// ---------- normalizers: provider body -> Listing[] (in-city rows, one per bed count) ----------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,+\s]|\/mo/g, ''));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
};
const sameCity = (a: unknown, city: string) => typeof a === 'string' && a.trim().toLowerCase() === city.toLowerCase();
/** Parse-based providers wrap the payload as { status, data }. */
const parsePayload = (body: unknown): Obj => {
  const b = obj(body);
  return 'data' in b && b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? obj(b.data) : b;
};

const SUFFIX: Record<string, string> = {
  street: 'st',
  avenue: 'ave',
  av: 'ave',
  boulevard: 'blvd',
  place: 'pl',
  drive: 'dr',
  terrace: 'ter',
  court: 'ct',
  lane: 'ln',
  road: 'rd',
  way: 'way',
  alley: 'aly',
  highway: 'hwy',
  square: 'sq',
};

/** "1433 Bush St, Unit 201, San Francisco, CA" -> "1433 bush st". Null without a street number. */
export function normalizeAddress(address: string | null): string | null {
  if (!address) return null;
  const street = address.split(',')[0].toLowerCase();
  const cleaned = street
    .replace(/\s+(apt|unit|ste|suite|#|no\.?)\s*[\w-]*$/i, '')
    .replace(/#\s*[\w-]+/g, '')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9 -]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length < 2) return null;
  const n = cleaned[0].match(/^(\d+)(?:-\d+)?[a-z]?$/);
  if (!n) return null;
  const words = cleaned.slice(1).map((w) => SUFFIX[w] ?? w);
  return [n[1], ...words].join(' ');
}

export function bedsFromText(text: string): number | null {
  const t = text.toLowerCase();
  if (/\bstudio\b|\befficiency\b|\bsro\b|\bjr\.? ?1\b/.test(t)) return 0;
  const m = t.match(/\b(\d)\s*(?:br|bd|bdrm|bed(?:room)?s?)\b|\b(one|two|three|four)[ -]bed(?:room)?s?\b/);
  if (!m) return null;
  return m[1] ? Number(m[1]) : { one: 1, two: 2, three: 3, four: 4 }[m[2] as 'one'];
}

const keyFor = (site: Site, id: string, address: string | null, beds: number) => {
  const a = normalizeAddress(address);
  return a ? `addr:${a}|${beds}` : `${site}:${id}|${beds}`;
};

function listing(
  site: Site,
  id: string,
  fields: Partial<Listing> & { beds: number; price: number; title: string },
): Listing {
  const base: Listing = {
    key: '',
    site,
    id,
    address: null,
    neighborhood: null,
    lat: null,
    lng: null,
    baths: null,
    price_from: false,
    sqft: null,
    url: null,
    posted: null,
    days_on_market: null,
    year_built: null,
    property_type: null,
    ...fields,
  };
  base.key = keyFor(site, id, base.address, base.beds);
  return base;
}

export function fromRentcast(body: unknown, city: string): Listing[] {
  return arr(body).flatMap((raw) => {
    const r = obj(raw);
    const beds = num(r.bedrooms);
    const price = num(r.price);
    if (beds === null || price === null || !sameCity(r.city, city)) return [];
    const address = str(r.formattedAddress);
    const type = str(r.propertyType);
    return [
      listing('rentcast', String(r.id ?? address), {
        title: `${beds === 0 ? 'Studio' : `${beds}BR`} ${type ?? 'rental'} at ${str(r.addressLine1) ?? address}`,
        address,
        lat: num(r.latitude),
        lng: num(r.longitude),
        beds,
        baths: num(r.bathrooms),
        price,
        sqft: num(r.squareFootage),
        posted: str(r.listedDate),
        days_on_market: num(r.daysOnMarket),
        year_built: num(r.yearBuilt),
        property_type: type,
      }),
    ];
  });
}

export function fromCraigslist(body: unknown, subarea: string | null): Listing[] {
  return arr(parsePayload(body).items).flatMap((raw) => {
    const r = obj(raw);
    const url = str(r.url);
    const price = num(r.price);
    const title = str(r.title) ?? '';
    if (!url || price === null) return [];
    // Search spans the whole region and its `location` field is unreliable; the subarea in the URL is not.
    if (subarea && url.split('/')[3] !== subarea) return [];
    const beds = num(r.bedrooms) ?? bedsFromText(title);
    if (beds === null) return [];
    return [
      listing('craigslist', String(r.id), {
        title,
        beds,
        price,
        sqft: num(r.sqft),
        url,
        posted: str(r.posted_date),
      }),
    ];
  });
}

export function fromPadmapper(body: unknown, city: string): Listing[] {
  return arr(parsePayload(body).listings).flatMap((raw) => {
    const r = obj(raw);
    const beds = num(r.min_bedrooms);
    const price = num(r.min_price);
    if (beds === null || price === null || !sameCity(r.city, city)) return [];
    const path = str(r.url) ?? str(r.padmapper_url);
    return [
      listing('padmapper', String(r.listing_id ?? r.building_id ?? path), {
        title: [str(r.building_name), str(r.title)].filter(Boolean).join(' - ') || 'PadMapper listing',
        address: str(r.address),
        neighborhood: str(r.neighborhood_name),
        lat: num(r.lat),
        lng: num(r.lng),
        beds,
        price,
        // The cheapest unit is usually the smallest; a range means other units cost more.
        price_from: num(r.max_price) !== price || num(r.max_bedrooms) !== beds,
        sqft: num(r.min_square_feet),
        url: path ? `https://www.padmapper.com${path}` : null,
      }),
    ];
  });
}

/** PadMapper returns neighborhood median asking prices with every search. */
export function padmapperMedians(body: unknown): Array<{ neighborhood: string; beds: number; median_price: number }> {
  return arr(parsePayload(body).neighborhoods).flatMap((raw) => {
    const n = obj(raw);
    const name = str(n.name);
    if (!name) return [];
    return arr(n.pricing).flatMap((p) => {
      const beds = num(obj(p).bedrooms);
      const median = num(obj(p).median_price);
      return beds !== null && beds >= 0 && median ? [{ neighborhood: name, beds, median_price: median }] : [];
    });
  });
}

export function fromRent(body: unknown, city: string): Listing[] {
  return arr(parsePayload(body).listings).flatMap((raw) => {
    const r = obj(raw);
    const loc = obj(r.location);
    if (!sameCity(loc.city, city)) return [];
    const path = str(r.urlPathname);
    const plans = arr(r.floorPlans).map(obj);
    return arr(r.bedCountData).flatMap((b) => {
      const beds = num(obj(b).beds);
      const price = num(obj(obj(b).prices).low);
      if (beds === null || price === null) return [];
      const plan = plans.filter((p) => num(p.bedCount) === beds);
      const max = Math.max(price, ...plan.map((p) => num(obj(p.priceRange).max) ?? price));
      return [
        listing('rent', `${String(r.id)}-${beds}`, {
          title: str(r.name) ?? 'Rent.com listing',
          address: str(r.addressFull) ?? str(r.address),
          lat: num(loc.lat),
          lng: num(loc.lng),
          beds,
          price,
          price_from: max > price,
          sqft: plan.length ? num(obj(plan[0].sqFtRange).min) : null,
          url: path ? `https://www.rent.com${path}` : null,
          property_type: str(r.propertyType),
        }),
      ];
    });
  });
}

/** Zillow gives some buildings a placeholder unit ("316 Valencia St #2a1f3d265, ..."); property lookups 404 on it. */
export const zillowAddress = (address: string | null) => address?.replace(/\s*#[0-9a-f]{8,}(?=,|$)/i, '') ?? null;

export function fromZillow(body: unknown, city: string): Listing[] {
  const d = parsePayload(body);
  const abs = (u: string | null) => (u ? (u.startsWith('http') ? u : `https://www.zillow.com${u}`) : null);
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const raw of [...arr(d.listings), ...arr(d.mapResults)]) {
    const r = obj(raw);
    const home = obj(obj(r.hdpData).homeInfo);
    const address = zillowAddress(str(r.address));
    const url = abs(str(r.detailUrl));
    const where = str(r.addressCity) ?? str(home.city) ?? address?.split(',').slice(-2, -1)[0] ?? null;
    if (!sameCity(where, city) || !url) continue;
    const ll = obj(r.latLong);
    const common = {
      address,
      lat: num(ll.latitude) ?? num(home.latitude),
      lng: num(ll.longitude) ?? num(home.longitude),
      url,
    };
    const units = arr(r.units).map(obj);
    const rows: Listing[] = [];
    if (r.isBuilding === true && units.length) {
      for (const u of units) {
        const beds = num(u.beds);
        const price = num(u.price);
        if (beds === null || price === null || u.roomForRent === true) continue;
        rows.push(
          listing('zillow', `${url}#${beds}`, {
            ...common,
            title: str(r.buildingName) ?? 'Zillow building',
            beds,
            price,
            price_from: String(u.price).includes('+'),
          }),
        );
      }
    } else if (r.isBuilding === true) {
      const beds = num(r.minBeds);
      const price = num(r.minBaseRent) ?? num(r.price);
      if (beds !== null && price !== null)
        rows.push(
          listing('zillow', `${url}#${beds}`, {
            ...common,
            title: str(r.buildingName) ?? 'Zillow building',
            beds,
            price,
            price_from: true,
          }),
        );
    } else {
      const beds = num(home.bedrooms) ?? num(r.beds);
      const price = num(home.price) ?? num(r.unformattedPrice) ?? num(r.price);
      if (beds !== null && price !== null)
        rows.push(
          listing('zillow', String(home.zpid ?? r.id ?? url), {
            ...common,
            title: `${beds === 0 ? 'Studio' : `${beds}BR`} ${str(home.homeType)?.toLowerCase() ?? 'rental'} at ${str(home.streetAddress) ?? address}`,
            beds,
            baths: num(home.bathrooms) ?? num(r.baths),
            price,
            price_from: String(r.price ?? '').includes('+'),
            sqft: num(home.livingArea) ?? num(r.area),
            property_type: str(home.homeType),
          }),
        );
    }
    for (const row of rows) {
      // listings and mapResults overlap; keep the first (listings carry per-bed prices).
      const k = `${row.url}|${row.beds}|${row.price}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(row);
      }
    }
  }
  return out;
}

export function normalize(site: Site, body: unknown, input: Input): Listing[] {
  if (site === 'rentcast') return fromRentcast(body, input.city);
  if (site === 'craigslist') return fromCraigslist(body, input.craigslist_subarea);
  if (site === 'padmapper') return fromPadmapper(body, input.city);
  if (site === 'rent') return fromRent(body, input.city);
  return fromZillow(body, input.city);
}

// ---------- areas ----------

/** Mapbox forward-geocode response -> the area's bbox, only when it lies in the searched city. */
export function areaFromGeocode(name: string, body: unknown, city: string): Area | { error: string } {
  const f = obj(arr(obj(body).features)[0]);
  const p = obj(f.properties);
  const bbox = arr(p.bbox).map(num);
  const full = str(p.full_address) ?? '';
  if (!full.toLowerCase().includes(city.toLowerCase())) return { error: `no area named "${name}" found in ${city}` };
  if (bbox.length !== 4 || bbox.some((n) => n === null)) return { error: `"${name}" has no boundary box` };
  const matched = str(p.name) ?? name;
  // Mapbox returns its closest guess ("Marina" -> Candlestick Point, "Lower Haight" -> Hayes Valley).
  const core = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(the|district|neighborhood)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  // Mapbox can also answer an alias with a neighbor's feature (name "Lower Haight", full address
  // "Hayes Valley, ..."), so both the name and the feature's own place name must match.
  const want = core(name);
  const same = (got: string) => got === want || ` ${got} `.includes(` ${want} `) || ` ${want} `.includes(` ${got} `);
  const place = full.split(',')[0];
  if (!want || !same(core(matched)) || !same(core(place)))
    return { error: `Mapbox matched "${place}" for "${name}"; pass this area as { name, lat, lng, radius_miles }` };
  const aliases = [...new Set([name, matched, place].map((s) => s.trim().toLowerCase()))];
  const zip = str(obj(obj(p.context).postcode).name);
  return { name, matched: place, bbox: bbox as BBox, aliases, ...(zip && /^\d{5}$/.test(zip) ? { zip } : {}) };
}

const R_MILES = 3958.8;
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function areaFor(
  l: Pick<Listing, 'lat' | 'lng' | 'title' | 'url' | 'neighborhood'>,
  areas: Area[],
): string | null {
  for (const a of areas) {
    if (l.lat !== null && l.lng !== null) {
      if (a.bbox) {
        const [x1, y1, x2, y2] = a.bbox;
        if (l.lng >= x1 && l.lng <= x2 && l.lat >= y1 && l.lat <= y2) return a.name;
      } else if (a.lat !== undefined && a.lng !== undefined && a.radius_miles !== undefined) {
        if (milesBetween(l.lat, l.lng, a.lat, a.lng) <= a.radius_miles) return a.name;
      }
    }
  }
  if (l.lat !== null && l.lng !== null) return null;
  // No coordinates (Craigslist search): only a whole-word area name in the title or URL counts,
  // and not as part of a street or another place ("Mission St", "Mission Bay", "Hayes St").
  const text =
    `${l.title} ${l.neighborhood ?? ''} ${(l.url ?? '').split('/').pop()?.replace(/-/g, ' ') ?? ''}`.toLowerCase();
  for (const a of areas) {
    for (const alias of [a.name.toLowerCase(), ...a.aliases]) {
      const re = new RegExp(`\\b${escapeRegExp(alias)}\\b(?!\\s+(?:bay|st|street|ave|avenue|blvd|rock|terrace)\\b)`);
      if (alias.length >= 4 && re.test(text)) return a.name;
    }
  }
  return null;
}

// ---------- merge, filter, rank ----------

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Merge the same unit seen on several sites; keep the most specific record and every source. */
export function merge(rows: Listing[]): OutListing[] {
  const byKey = new Map<string, OutListing>();
  // Craigslist reposts the same unit under new IDs; same title, beds and price is the same post.
  const clSeen = new Map<string, string>();
  for (const r of rows) {
    let key = r.key;
    if (r.site === 'craigslist') {
      const t = `${r.title.toLowerCase().replace(/\W+/g, ' ').trim()}|${r.beds}|${r.price}`;
      key = clSeen.get(t) ?? key;
      clSeen.set(t, key);
    }
    const { site, id: _id, ...rest } = r;
    const source = { site, url: r.url, price: r.price };
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { ...rest, key, area: null, sources: [source], flags: [] });
      continue;
    }
    if (!cur.sources.some((s) => s.site === site && s.url === r.url)) cur.sources.push(source);
    const better = (!r.price_from && cur.price_from) || (r.price_from === cur.price_from && r.price < cur.price);
    const next = better ? { ...cur, ...rest, key, sources: cur.sources, area: null, flags: [] } : cur;
    for (const k of [
      'address',
      'neighborhood',
      'lat',
      'lng',
      'baths',
      'sqft',
      'url',
      'posted',
      'days_on_market',
      'year_built',
      'property_type',
    ] as const) {
      if (next[k] === null || next[k] === undefined)
        (next as unknown as Record<string, unknown>)[k] = (better ? cur : r)[k] ?? null;
    }
    byKey.set(key, next);
  }
  return [...byKey.values()];
}

export function finish(
  input: Input,
  areas: Area[],
  rows: Listing[],
  medians: Output['neighborhoods'],
  searchedAreas: Output['searched']['areas'],
  sites: Output['sites'],
): Output {
  const market = input.beds.flatMap((beds) => {
    const prices = rows.filter((r) => r.site === 'rentcast' && r.beds === beds).map((r) => r.price);
    const m = median(prices);
    return m ? [{ beds, median_price: m, listings: prices.length }] : [];
  });
  const medianFor = new Map(market.map((m) => [m.beds, m.median_price]));
  const wanted = rows.filter(
    (r) => input.beds.includes(r.beds) && r.price >= Math.max(input.min_price, 100) && r.price <= input.max_price,
  );
  const merged = merge(wanted);
  const seen = new Set(input.seen);
  // Areas were asked for: never fall back to the whole city, even if none could be found.
  const byArea = input.areas.length > 0;
  const listings: OutListing[] = [];
  const unlocated: OutListing[] = [];
  let alreadySeen = 0;
  for (const l of merged) {
    if (seen.has(l.key)) {
      alreadySeen++;
      continue;
    }
    l.area = byArea ? areaFor(l, areas) : null;
    const m = medianFor.get(l.beds);
    if (m && !l.price_from && l.price < 0.6 * m) l.flags.push('far_below_market');
    if (l.days_on_market !== null && l.days_on_market > 60) l.flags.push('listed_over_60_days');
    if (l.sources.length > 1) l.flags.push(`on_${l.sources.length}_sites`);
    if (!byArea || l.area) listings.push(l);
    else if (l.lat === null) unlocated.push(l);
  }
  const byPrice = (a: OutListing, b: OutListing) => a.price - b.price || (b.posted ?? '').localeCompare(a.posted ?? '');
  listings.sort(byPrice);
  unlocated.sort(byPrice);
  const kept = listings.slice(0, input.max_results);
  const keptUnlocated = unlocated.slice(0, Math.max(0, input.max_results - kept.length));
  return {
    searched: {
      city: input.city,
      state: input.state,
      beds: input.beds,
      min_price: input.min_price,
      max_price: input.max_price,
      areas: searchedAreas,
    },
    sites,
    market,
    neighborhoods: medians.filter((n) => input.beds.includes(n.beds)),
    listings: kept,
    unlocated: keptUnlocated,
    already_seen: alreadySeen,
    new_keys: [...kept, ...keptUnlocated].map((l) => l.key),
    truncated: kept.length < listings.length || keptUnlocated.length < unlocated.length,
  };
}

/** Quality gate: nothing outside the user's budget, beds, or areas reaches the agent. */
export function parseOutput(value: unknown): Output {
  const o = value as Output;
  if (!o || !Array.isArray(o.listings) || !o.searched) fail('output must contain searched and listings');
  const { beds, min_price, max_price, areas } = o.searched;
  const keys = new Set<string>();
  for (const l of [...o.listings, ...(o.unlocated ?? [])]) {
    if (!beds.includes(l.beds)) fail(`listing ${l.key} has ${l.beds} beds`);
    if (l.price < min_price || l.price > max_price) fail(`listing ${l.key} costs ${l.price}`);
    if (!l.url && !l.address) fail(`listing ${l.key} has neither a URL nor an address`);
    if (keys.has(l.key)) fail(`duplicate listing ${l.key}`);
    keys.add(l.key);
  }
  if (areas.length && o.listings.some((l) => !l.area)) fail('a listing outside the requested areas leaked');
  return o;
}
