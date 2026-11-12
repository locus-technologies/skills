import {
  type Area,
  areaFor,
  areaFromGeocode,
  areaZips,
  bedsFromText,
  finish,
  fromCraigslist,
  fromPadmapper,
  fromRent,
  fromRentcast,
  fromZillow,
  normalizeAddress,
  parseInput,
  parseOutput,
  siteRequests,
  zillowRequests,
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
    state: 'ca',
    beds: [1],
    max_price: 3800,
    areas: ['Mission', 'Bernal Heights'],
    craigslist_site: 'sfbay.craigslist.org',
    craigslist_subarea: 'sfc',
  });
  assert(input.state === 'CA' && input.min_price === 0 && input.pages === 1, 'defaults');
  rejects(() => parseInput({ city: 'San Francisco', state: 'XX', beds: [1], max_price: 3800 }), 'bad state');
  rejects(() => parseInput({ city: 'San Francisco', state: 'CA', max_price: 3800 }), 'beds required');
  rejects(
    () => parseInput({ city: 'San Francisco', state: 'CA', beds: [1], max_price: 3800, craigslist_site: 'evil.com' }),
    'bad craigslist site',
  );
  const noCl = parseInput({ city: 'Austin', state: 'TX', beds: [0, 1], max_price: 2000 });
  assert(!noCl.sites.includes('craigslist'), 'craigslist needs a site');
  const reqs = siteRequests(input);
  const arg = (site: string) => reqs.find((r) => r.site === site)?.args ?? {};
  assert(arg('rent').location_slug === 'california/san-francisco', 'rent.com slug');
  assert(arg('padmapper').city_slug === 'san-francisco-ca', 'padmapper slug');
  assert(!('price' in arg('rentcast')) && arg('rentcast').limit === 500, 'rentcast unfiltered for the market median');
  assert(!reqs.some((r) => r.site === 'zillow'), 'with areas, zillow waits for their ZIP codes');
  assert(
    siteRequests(noCl).some((r) => r.site === 'zillow' && r.args.location === 'Austin, TX'),
    'without areas, zillow searches the city',
  );
  cases.push('input');

  assert(normalizeAddress('1433 Bush St, Unit 201, San Francisco, CA 94109') === '1433 bush st', 'unit stripped');
  assert(normalizeAddress("888 O'Farrell Street, San Francisco") === '888 ofarrell st', 'apostrophe and suffix');
  assert(normalizeAddress('1735 Van Ness Ave APT 601, San Francisco, CA') === '1735 van ness ave', 'apt stripped');
  assert(normalizeAddress('1030-1042 Polk St, San Francisco') === '1030 polk st', 'number range');
  assert(normalizeAddress('Sunny flat near the park') === null, 'no street number');
  assert(bedsFromText('Gorgeous Studio Unit near Union Square!') === 0, 'studio');
  assert(bedsFromText('Amazing 1 BR, 1 BA apt') === 1, '1 BR');
  assert(bedsFromText('Sunny two-bedroom flat') === 2, 'two-bedroom');
  assert(bedsFromText('Sunny flat, great light') === null, 'unknown beds');
  cases.push('text');

  // Real response shapes, trimmed.
  const rc = fromRentcast(
    [
      {
        formattedAddress: '2023 Folsom St, San Francisco, CA 94110',
        addressLine1: '2023 Folsom St',
        city: 'San Francisco',
        bedrooms: 1,
        price: 2495,
        latitude: 37.765,
        longitude: -122.415,
        propertyType: 'Apartment',
        yearBuilt: 1907,
        daysOnMarket: 90,
        id: 'a',
      },
      { formattedAddress: '1 Main St, Oakland, CA', city: 'Oakland', bedrooms: 1, price: 2000, id: 'b' },
    ],
    'San Francisco',
  );
  assert(rc.length === 1 && rc[0].key === 'addr:2023 folsom st|1' && rc[0].year_built === 1907, 'rentcast');
  const cl = fromCraigslist(
    {
      status: 'success',
      data: {
        items: [
          {
            id: 1,
            title: 'Pleasanton 1BR',
            price: 2426,
            bedrooms: 1,
            location: 'north beach',
            url: 'https://sfbay.craigslist.org/eby/apa/d/pleasanton/1.html',
          },
          {
            id: 2,
            title: 'Sunny Bernal Heights 1BR with yard',
            price: 3100,
            bedrooms: null,
            location: 'hayward',
            url: 'https://sfbay.craigslist.org/sfc/apa/d/san-francisco-sunny/2.html',
          },
          {
            id: 3,
            title: 'Charming flat',
            price: 3000,
            bedrooms: null,
            url: 'https://sfbay.craigslist.org/sfc/apa/d/san-francisco-charming/3.html',
          },
        ],
      },
    },
    'sfc',
  );
  assert(cl.length === 1 && cl[0].id === '2' && cl[0].beds === 1, 'craigslist subarea and beds from title');
  const pm = fromPadmapper(
    {
      data: {
        listings: [
          {
            address: '1010 16th St',
            city: 'San Francisco',
            lat: 37.767,
            lng: -122.397,
            min_price: 3786,
            max_price: 6001,
            min_bedrooms: 1,
            max_bedrooms: 2,
            neighborhood_name: 'Potrero Hill',
            url: '/apartment-buildings/p13179/potrero-1010',
            listing_id: 9,
          },
        ],
      },
    },
    'San Francisco',
  );
  assert(
    pm[0].price_from && pm[0].url === 'https://www.padmapper.com/apartment-buildings/p13179/potrero-1010',
    'padmapper',
  );
  const rent = fromRent(
    {
      data: {
        listings: [
          {
            id: 'lc1',
            name: '2055 Sacramento',
            addressFull: '2055 Sacramento St, San Francisco, CA 94109',
            location: { city: 'San Francisco', lat: 37.79, lng: -122.42 },
            urlPathname: '/apartment/x-lc1',
            bedCountData: [
              { beds: 1, prices: { low: 5300 } },
              { beds: 2, prices: { low: 6245 } },
            ],
            floorPlans: [{ bedCount: 1, priceRange: { min: 5300, max: 5540 } }],
          },
        ],
      },
    },
    'San Francisco',
  );
  assert(
    rent.length === 2 && rent[0].price_from && rent[0].url === 'https://www.rent.com/apartment/x-lc1',
    'rent.com per-bed rows',
  );
  const zl = fromZillow(
    {
      data: {
        listings: [
          {
            isBuilding: true,
            address: '1188 Mission St, San Francisco, CA',
            addressCity: 'San Francisco',
            buildingName: 'Trinity',
            detailUrl: '/apartments/sf/trinity/5X/',
            latLong: { latitude: 37.778, longitude: -122.412 },
            units: [{ beds: '1', price: '$3,574+' }],
          },
        ],
        mapResults: [
          {
            isBuilding: true,
            address: '1188 Mission St, San Francisco, CA',
            detailUrl: '/apartments/sf/trinity/5X/',
            minBeds: 1,
            price: '$3,574+/mo',
            latLong: { latitude: 37.778, longitude: -122.412 },
          },
          {
            address: '1735 Van Ness Ave APT 601, San Francisco, CA 94109',
            detailUrl: '/apartments/sf/1735/Cs/',
            hdpData: { homeInfo: { bedrooms: 2, price: 10840, city: 'San Francisco', homeType: 'APARTMENT', zpid: 7 } },
            latLong: { latitude: 37.79, longitude: -122.42 },
          },
          {
            address: '1 Main St, Daly City, CA',
            detailUrl: '/x/',
            hdpData: { homeInfo: { bedrooms: 1, price: 2000, city: 'Daly City' } },
          },
        ],
      },
    },
    'San Francisco',
  );
  assert(
    zl.length === 2 && zl[0].price === 3574 && zl[0].url === 'https://www.zillow.com/apartments/sf/trinity/5X/',
    'zillow units, map overlap, city',
  );
  cases.push('normalizers');

  const mission = areaFromGeocode(
    'Mission',
    {
      features: [
        {
          properties: {
            name: 'Mission',
            full_address: 'Mission District, San Francisco, California, United States',
            bbox: [-122.425857, 37.747829, -122.402824, 37.770779],
            context: { postcode: { name: '94110' } },
          },
        },
      ],
    },
    'San Francisco',
  ) as Area;
  assert(
    mission.matched === 'Mission District' && mission.bbox?.[0] === -122.425857 && mission.zip === '94110',
    'mission bbox and ZIP',
  );
  const wrong = areaFromGeocode(
    'Lower Haight',
    {
      features: [
        {
          properties: {
            name: 'Lower Haight',
            full_address: 'Hayes Valley, San Francisco, California, United States',
            bbox: [-122.43, 37.76, -122.42, 37.77],
          },
        },
      ],
    },
    'San Francisco',
  );
  assert('error' in wrong, 'a neighbor feature is rejected');
  const elsewhere = areaFromGeocode(
    'Mission',
    { features: [{ properties: { name: 'Mission', full_address: 'Mission, Kansas', bbox: [0, 0, 1, 1] } }] },
    'San Francisco',
  );
  assert('error' in elsewhere, 'another city is rejected');
  const bernal: Area = {
    name: 'Bernal Heights',
    bbox: [-122.432417, 37.731765, -122.403958, 37.748962],
    aliases: ['bernal heights'],
  };
  const at = (lat: number, lng: number, title = '') => ({ lat, lng, title, url: null, neighborhood: null });
  assert(areaFor(at(37.765, -122.415), [mission, bernal]) === 'Mission', 'inside bbox');
  assert(areaFor(at(37.79, -122.42), [mission, bernal]) === null, 'outside');
  assert(
    areaFor({ lat: null, lng: null, title: 'Sunny Bernal Heights 1BR', url: null, neighborhood: null }, [
      mission,
      bernal,
    ]) === 'Bernal Heights',
    'title match',
  );
  assert(
    areaFor({ lat: null, lng: null, title: 'Luxury 1BR in Mission Bay', url: null, neighborhood: null }, [mission]) ===
      null,
    'Mission Bay is not the Mission',
  );
  assert(
    areaFor({ lat: null, lng: null, title: '1BR near Mission St', url: null, neighborhood: null }, [mission]) === null,
    'a street is not the area',
  );
  const circle: Area = { name: 'Near office', lat: 37.7942, lng: -122.3949, radius_miles: 1, aliases: [] };
  assert(
    areaFor(at(37.79, -122.4), [circle]) === 'Near office' && areaFor(at(37.75, -122.42), [circle]) === null,
    'radius',
  );
  cases.push('areas');

  const rows = [...rc, ...cl, ...pm, ...rent, ...zl];
  assert(areaZips(rows, [mission, bernal], 3).join() === '94110', 'ZIPs inside the areas');
  assert(
    areaZips(rows, [mission, { ...bernal, zip: '94131' }], 1).join() === '94110' &&
      areaZips(rows, [{ ...bernal, zip: '94131' }, mission], 3).join() === '94131,94110',
    'every area center ZIP comes before ZIPs by listing count',
  );
  assert(
    zillowRequests(input, ['94110']).length === 1 && zillowRequests(input, ['94110'])[0].args.location === '94110',
    'zillow by ZIP',
  );
  // The same unit on RentCast and Zillow merges into one listing with both sources.
  const dup = fromZillow(
    {
      data: {
        mapResults: [
          {
            address: '2023 Folsom St, San Francisco, CA 94110',
            detailUrl: '/f/',
            hdpData: { homeInfo: { bedrooms: 1, price: 2495, city: 'San Francisco' } },
            latLong: { latitude: 37.765, longitude: -122.415 },
          },
        ],
      },
    },
    'San Francisco',
  );
  const out = finish(input, [mission, bernal], [...rows, ...dup], [], [], {});
  parseOutput(out);
  const folsom = out.listings.find((l) => l.key === 'addr:2023 folsom st|1');
  assert(
    !!folsom && folsom.sources.length === 2 && folsom.area === 'Mission' && folsom.year_built === 1907,
    'merged across sites',
  );
  assert(
    out.listings.every((l) => l.price <= 3800 && l.beds === 1),
    'budget and beds',
  );
  assert(
    out.listings.some((l) => l.key.startsWith('craigslist:2')),
    'craigslist listing placed by its title',
  );
  const again = finish({ ...input, seen: out.new_keys }, [mission, bernal], rows, [], [], {});
  assert(again.listings.length === 0 && again.already_seen === out.new_keys.length, 'seen listings are not new');
  const noAreas = finish(input, [], rows, [], [], {});
  assert(noAreas.listings.length === 0, 'areas asked for but none found: no whole-city fallback');
  rejects(
    () => parseOutput({ ...out, listings: [{ ...out.listings[0], price: 9000 }] }),
    'output gate rejects an over-budget listing',
  );
  cases.push('merge-filter-seen');

  return { ok: true, cases };
}
