// Pure rules for vet-listings. They live under tests/ so both the entrypoint
// (./tests/rules.ts) and tests/fixtures.ts (./rules.ts) can import them without a
// parent-directory path, which the Locus API firewall rejects.

export type Mode = 'cycling' | 'walking' | 'driving-traffic' | 'driving';
const MODES: Mode[] = ['cycling', 'walking', 'driving-traffic', 'driving'];

export interface VetListing {
  id: string;
  url: string | null;
  title: string | null;
  /** The listing's own text; fetched from Craigslist when only a Craigslist URL is given. */
  text: string | null;
  address: string | null;
  /** Used to estimate the market rent when there is no address. */
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  beds: number | null;
  baths: number | null;
  price: number | null;
  property_type: string | null;
  year_built: number | null;
}

export interface Input {
  city: string;
  state: string;
  listings: VetListing[];
  /** Rent-control rules to apply. Only San Francisco's are built in. */
  rent_control: 'san-francisco' | 'none';
  commute: { to: string; modes: Mode[] } | null;
}

export type Risk = 'high' | 'medium' | 'low';
export type RentControl = 'likely' | 'unlikely' | 'unknown' | 'not_checked';

export interface Result {
  id: string;
  url: string | null;
  title: string | null;
  address: string | null;
  price: number | null;
  beds: number | null;
  /** address: geocoded or RentCast's subject property; listing: the site's own (Craigslist blurs it); area: a neighborhood center. */
  location: { lat: number; lng: number; precision: 'address' | 'listing' | 'area' } | null;
  market: {
    estimate: number;
    low: number | null;
    high: number | null;
    comparables: number;
    price_ratio: number | null;
  } | null;
  scam: { risk: Risk; signals: string[] };
  rent_control: {
    status: RentControl;
    reason: string;
    year_built: number | null;
    year_built_source: 'listing input' | 'rentcast' | null;
    property_type: string | null;
    units: number | null;
    mentions_rent_ordinance: boolean;
  };
  commute: { to: string; minutes: Partial<Record<Mode, number>> } | null;
  listing_status: 'active' | 'unavailable' | 'not_checked';
  errors: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[$,\s]|\/mo/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export function parseInput(value: unknown): Input {
  if (!value || typeof value !== 'object') fail('input must be an object');
  const v = value as Obj;
  const city = str(v.city) ?? fail('city is required');
  const state = (str(v.state) ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) fail('state must be a 2-letter US state code');
  if (!Array.isArray(v.listings) || v.listings.length === 0 || v.listings.length > 25)
    fail('listings must hold 1-25 listings');
  const ids = new Set<string>();
  const listings = v.listings.map((raw, i): VetListing => {
    const l = obj(raw);
    const url = str(l.url);
    if (url && !/^https:\/\/[\w.-]+\//.test(url)) fail(`listings[${i}].url must be an https URL`);
    const l2: VetListing = {
      id: str(l.id) ?? url ?? str(l.address) ?? `listing-${i + 1}`,
      url,
      title: str(l.title),
      text: str(l.text),
      address: str(l.address),
      neighborhood: str(l.neighborhood),
      lat: num(l.lat),
      lng: num(l.lng),
      beds: num(l.beds),
      baths: num(l.baths),
      price: num(l.price),
      property_type: str(l.property_type),
      year_built: num(l.year_built),
    };
    if (!l2.url && !l2.address && !l2.text && l2.lat === null)
      fail(`listings[${i}] needs a url, address, text, or lat/lng`);
    if (ids.has(l2.id)) fail(`duplicate listing id ${l2.id}`);
    ids.add(l2.id);
    return l2;
  });
  const rc = v.rent_control ?? (city.toLowerCase() === 'san francisco' ? 'san-francisco' : 'none');
  if (rc !== 'san-francisco' && rc !== 'none') fail('rent_control must be "san-francisco" or "none"');
  let commute: Input['commute'] = null;
  if (v.commute !== undefined && v.commute !== null) {
    const c = obj(v.commute);
    const to = str(c.to) ?? fail('commute.to must be an address');
    const modes = (c.modes === undefined ? ['cycling', 'walking', 'driving-traffic'] : c.modes) as unknown[];
    if (!Array.isArray(modes) || modes.length === 0 || modes.some((m) => !MODES.includes(m as Mode)))
      fail(`commute.modes must use ${MODES.join(', ')} (no transit routing is available)`);
    commute = { to, modes: [...new Set(modes as Mode[])] };
  }
  return { city, state, listings, rent_control: rc, commute };
}

export const isCraigslist = (url: string | null) => !!url && /^https:\/\/[a-z]+\.craigslist\.org\//.test(url);
/** A street number is what RentCast needs for property records. */
export const hasStreetNumber = (address: string | null) => !!address && /^\s*\d+[a-z]?\b/i.test(address);

/** craigslist/get-listing-detail -> listing fields. */
export function fromCraigslistDetail(body: unknown): Partial<VetListing> {
  const b = obj(body);
  const d = obj('data' in b && b.data && typeof b.data === 'object' ? b.data : b);
  const attrs = Object.keys(obj(d.attributes)).join(' ');
  const bedsMatch = attrs.match(/(\d+)BR\b/i);
  const street = str(d.address);
  const city = str(d.city);
  return {
    title: str(d.title),
    text: [str(d.title), str(d.description)].filter(Boolean).join('\n'),
    address: street ? [street, city, str(d.region), str(d.postal_code)].filter(Boolean).join(', ') : null,
    lat: num(d.latitude),
    lng: num(d.longitude),
    price: num(d.price),
    beds: bedsMatch ? Number(bedsMatch[1]) : /\bstudio\b/i.test(attrs) ? 0 : null,
  };
}

/** mapbox/geocode-forward -> coordinates of the first feature, or null. */
export function fromGeocode(body: unknown): { lat: number; lng: number; name: string } | null {
  const f = obj(arr(obj(body).features)[0]);
  const c = arr(obj(f.geometry).coordinates).map(num);
  if (c.length < 2 || c[0] === null || c[1] === null) return null;
  return { lng: c[0], lat: c[1], name: str(obj(f.properties).full_address) ?? str(obj(f.properties).name) ?? '' };
}

/** rentcast/rent-estimate -> estimate and the subject property's coordinates. */
export function fromEstimate(body: unknown): {
  estimate: number | null;
  low: number | null;
  high: number | null;
  comparables: number;
  lat: number | null;
  lng: number | null;
} {
  const b = obj(body);
  return {
    estimate: num(b.rent),
    low: num(b.rentRangeLow),
    high: num(b.rentRangeHigh),
    comparables: arr(b.comparables).length,
    lat: num(b.latitude),
    lng: num(b.longitude),
  };
}

/** rentcast/properties -> the record's build year, type and unit count. */
export function fromProperties(body: unknown): {
  year_built: number | null;
  property_type: string | null;
  units: number | null;
} {
  const p = obj(arr(body)[0]);
  return {
    year_built: num(p.yearBuilt),
    property_type: str(p.propertyType),
    units: num(obj(p.features).unitCount),
  };
}

/** mapbox/directions -> minutes for the fastest route. */
export function fromDirections(body: unknown): number | null {
  const d = num(obj(arr(obj(body).routes)[0]).duration);
  return d === null ? null : Math.round(d / 60);
}

// ---------- scam signals (FTC and Craigslist rental-scam guidance) ----------

const SIGNALS: Array<[string, RegExp, 'strong' | 'weak']> = [
  [
    'asks for payment by wire, gift card, crypto, or payment app',
    /\b(wire|western union|moneygram|gift ?cards?|bitcoin|crypto|zelle|venmo|cash ?app|paypal friends)\b/i,
    'strong',
  ],
  [
    'wants money before a viewing',
    /\b(deposit|payment|first month|rent)\b[^.!?\n]{0,60}\b(before|prior to)\b[^.!?\n]{0,30}\b(view|viewing|showing|seeing|see it|tour)/i,
    'strong',
  ],
  [
    'keys mailed or no viewing possible',
    /\b(mail|ship|send|courier)\w*\b[^.!?\n]{0,30}\bkeys?\b|\bkeys?\b[^.!?\n]{0,30}\b(mailed|shipped|sent)\b|\b(can'?t|cannot|unable to|no)\s+(show|showings?|viewings?)\b|\bdrive by only\b/i,
    'strong',
  ],
  [
    'landlord says they are away',
    /\b(out of (the )?(country|state|town)|overseas|abroad|missionary|deployed|military assignment|relocated for work)\b/i,
    'weak',
  ],
  [
    'moves contact off the site',
    /\b(text|email|e-mail|whatsapp)\s+(me\s+)?(at|on|directly)\b|@(gmail|yahoo|outlook|hotmail|aol)\.com\b/i,
    'weak',
  ],
  [
    'pressure to decide now',
    /\b(first (come|person)[^.!?\n]{0,20}(serve|pays)|today only|won'?t last|act (fast|now))\b/i,
    'weak',
  ],
];

/** Below this share of the market estimate a price is not believable on its own. */
export const FAR_BELOW = 0.6;

export function scamCheck(text: string | null, priceRatio: number | null): { risk: Risk; signals: string[] } {
  const hits = SIGNALS.filter(([, re]) => text && re.test(text));
  const signals = hits.map(([label]) => label);
  const strong = hits.filter(([, , weight]) => weight === 'strong').length;
  const farBelow = priceRatio !== null && priceRatio < FAR_BELOW;
  if (farBelow) signals.unshift(`asks ${Math.round(priceRatio * 100)}% of the estimated market rent`);
  // One weak signal alone (a Gmail address, "first come first served") is common in real ads.
  const risk: Risk =
    strong > 0 || (farBelow && hits.length > 0) ? 'high' : farBelow || hits.length - strong >= 2 ? 'medium' : 'low';
  return { risk, signals };
}

// ---------- San Francisco rent control ----------

const ORDINANCE = /\b(rent[- ]controlled|rent control|rent ordinance|rent stabiliz)/i;

/**
 * San Francisco's rent-increase limits generally cover units in buildings first occupied
 * before June 13, 1979. Costa-Hawkins exempts most single-family homes and condos from
 * them. A build year from 1979 itself is ambiguous. Nothing here is a legal determination.
 */
export function rentControlSF(f: { year_built: number | null; property_type: string | null; units: number | null }): {
  status: RentControl;
  reason: string;
} {
  const type = (f.property_type ?? '').toLowerCase();
  const single = /single family|condo|townhouse|manufactured/.test(type);
  const multi = /apartment|multi-family|multifamily/.test(type) || (f.units !== null && f.units >= 2);
  if (f.year_built === null) return { status: 'unknown', reason: 'no build year on record' };
  if (f.year_built >= 1980) return { status: 'unlikely', reason: `built ${f.year_built}, after the June 1979 cutoff` };
  if (f.year_built === 1979) return { status: 'unknown', reason: 'built 1979; the cutoff is June 13, 1979' };
  // RentCast labels some San Francisco apartment buildings "Single Family" (2023 Folsom St has
  // 11 units on the Assessor roll), so its type alone never settles an exemption.
  if (single)
    return {
      status: 'unknown',
      reason: `built ${f.year_built}; RentCast lists a ${f.property_type}, which would be exempt (Costa-Hawkins), but confirm the building type`,
    };
  if (multi) return { status: 'likely', reason: `multi-unit building built ${f.year_built}, before June 1979` };
  return { status: 'unknown', reason: `built ${f.year_built}, but the building type is unknown` };
}

export function mentionsOrdinance(text: string | null): boolean {
  return !!text && ORDINANCE.test(text);
}

/** Quality gate: verdicts must follow from the evidence they carry. */
export function parseOutput(value: unknown): { results: Result[] } {
  const results = (value as { results?: unknown })?.results;
  if (!Array.isArray(results)) fail('output must contain results');
  for (const r of results as Result[]) {
    const rc = r.rent_control;
    if (rc.status === 'likely' && (rc.year_built === null || rc.year_built >= 1979))
      fail(`${r.id}: "likely" rent control without a pre-1979 build year`);
    if (rc.status === 'unlikely' && rc.year_built === null)
      fail(`${r.id}: "unlikely" rent control without a build year`);
    const ratio = r.market?.price_ratio ?? null;
    if (ratio !== null && ratio < FAR_BELOW && r.scam.risk === 'low')
      fail(`${r.id}: far-below-market price marked low risk`);
  }
  return { results: results as Result[] };
}
