import {
  fromCraigslistDetail,
  fromDirections,
  fromEstimate,
  fromGeocode,
  fromProperties,
  hasStreetNumber,
  mentionsOrdinance,
  parseInput,
  parseOutput,
  rentControlSF,
  scamCheck,
} from './rules.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function rejects(fn: () => unknown, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

export default function runFixtures() {
  const cases: string[] = [];

  const input = parseInput({
    city: 'San Francisco',
    state: 'CA',
    listings: [
      { url: 'https://sfbay.craigslist.org/sfc/apa/d/x/1.html' },
      { address: '346 Leavenworth St', beds: 1, price: 2900 },
    ],
    commute: { to: '1 Market St, San Francisco' },
  });
  assert(input.rent_control === 'san-francisco', 'SF rules by default in SF');
  assert(input.commute?.modes.join() === 'cycling,walking,driving-traffic', 'default modes');
  assert(
    parseInput({ city: 'Austin', state: 'TX', listings: [{ text: 'x' }] }).rent_control === 'none',
    'no rules elsewhere',
  );
  rejects(
    () =>
      parseInput({
        city: 'San Francisco',
        state: 'CA',
        listings: [{ text: 'x' }],
        commute: { to: 'x', modes: ['transit'] },
      }),
    'no transit',
  );
  rejects(() => parseInput({ city: 'San Francisco', state: 'CA', listings: [{}] }), 'listing needs something to check');
  assert(hasStreetNumber('346 Leavenworth St') && !hasStreetNumber('Hayes Valley'), 'street number');
  cases.push('input');

  // Real response shapes, trimmed.
  const d = fromCraigslistDetail({
    status: 'success',
    data: {
      address: "888 O'Farrell Street",
      city: 'San Francisco',
      region: 'CA',
      postal_code: '94109',
      attributes: { '1BR / 1Ba': true, '764ft2': true },
      description: 'This unit is a rental unit subject to the San Francisco Rent Ordinance.',
      latitude: '37.791700',
      longitude: '-122.418600',
      price: '$3,376',
      title: 'Dive Into Comfort',
    },
  });
  assert(
    d.address === "888 O'Farrell Street, San Francisco, CA, 94109" &&
      d.price === 3376 &&
      d.beds === 1 &&
      d.lat === 37.7917,
    'craigslist detail',
  );
  const e = fromEstimate({
    rent: 3060,
    rentRangeLow: 2900,
    rentRangeHigh: 3220,
    latitude: 37.785296,
    longitude: -122.419013,
    comparables: [{}, {}],
  });
  assert(e.estimate === 3060 && e.comparables === 2 && e.lat === 37.785296, 'estimate');
  const p = fromProperties([{ propertyType: 'Apartment', yearBuilt: null, features: { unitCount: 262 } }]);
  assert(p.year_built === null && p.units === 262, 'property record');
  assert(
    fromDirections({ code: 'Ok', routes: [{ duration: 555.4 }] }) === 9 && fromDirections({ routes: [] }) === null,
    'directions',
  );
  assert(
    fromGeocode({
      features: [{ geometry: { coordinates: [-122.3949, 37.794] }, properties: { full_address: '1 Market Street' } }],
    })?.lat === 37.794,
    'geocode',
  );
  cases.push('parsers');

  const planted =
    "$950/month 1BR in Hayes Valley. I'm overseas for work so I can't show it, but I'll mail you the keys once you wire the deposit. Text me at (415) 555-0134.";
  const scam = scamCheck(planted, 950 / 3400);
  assert(scam.risk === 'high' && scam.signals.length >= 4, 'planted scam is high risk');
  assert(
    scamCheck('Sunny 1BR. Contact me at landlord@gmail.com', 0.95).risk === 'low',
    'one weak signal alone stays low',
  );
  assert(scamCheck('Sunny 1BR, great light.', 0.5).risk === 'medium', 'price alone is medium');
  assert(
    scamCheck('Security deposit due at lease signing. Showings Saturday.', 1).risk === 'low',
    'a normal deposit is fine',
  );
  assert(scamCheck('Send the deposit before the showing to hold it.', 1).risk === 'high', 'money before viewing');
  assert(mentionsOrdinance(d.text ?? null), 'ordinance mention noted');
  cases.push('scam');

  assert(
    rentControlSF({ year_built: 1924, property_type: 'Multi-Family', units: 25 }).status === 'likely',
    'pre-1979 multi-unit',
  );
  assert(
    rentControlSF({ year_built: 2010, property_type: 'Apartment', units: 440 }).status === 'unlikely',
    'post-1979',
  );
  assert(
    rentControlSF({ year_built: null, property_type: 'Apartment', units: 262 }).status === 'unknown',
    'no year: unknown, not guessed',
  );
  assert(
    rentControlSF({ year_built: 1979, property_type: 'Apartment', units: 10 }).status === 'unknown',
    '1979 is ambiguous',
  );
  assert(
    rentControlSF({ year_built: 1902, property_type: 'Single Family', units: null }).status === 'unknown',
    'a RentCast single-family label alone is not an exemption',
  );
  assert(rentControlSF({ year_built: 1950, property_type: null, units: null }).status === 'unknown', 'type unknown');
  cases.push('rent-control');

  const base = {
    id: 'a',
    url: null,
    title: null,
    address: null,
    price: 950,
    beds: 1,
    location: null,
    commute: null,
    listing_status: 'not_checked',
    errors: [],
  };
  const rc = {
    reason: '',
    property_type: 'Apartment',
    units: 10,
    year_built_source: 'rentcast',
    mentions_rent_ordinance: false,
  };
  rejects(
    () =>
      parseOutput({
        results: [
          {
            ...base,
            market: null,
            scam: { risk: 'low', signals: [] },
            rent_control: { ...rc, status: 'likely', year_built: null },
          },
        ],
      }),
    'likely without a year is rejected',
  );
  rejects(
    () =>
      parseOutput({
        results: [
          {
            ...base,
            market: { estimate: 3400, low: null, high: null, comparables: 5, price_ratio: 0.28 },
            scam: { risk: 'low', signals: [] },
            rent_control: { ...rc, status: 'unknown', year_built: null },
          },
        ],
      }),
    'far below market cannot be low risk',
  );
  cases.push('quality-gate');

  return { ok: true, cases };
}
