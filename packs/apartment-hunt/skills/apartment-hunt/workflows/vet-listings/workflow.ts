import { defineWorkflow } from '@withlocus/workflows';
import {
  fromCraigslistDetail,
  fromDirections,
  fromEstimate,
  fromGeocode,
  fromProperties,
  hasStreetNumber,
  type Input,
  isCraigslist,
  type Mode,
  mentionsOrdinance,
  parseInput,
  parseOutput,
  type Result,
  rentControlSF,
  scamCheck,
  type VetListing,
} from './tests/rules.ts';

// Vet a shortlist of rental listings: fetch the full Craigslist post when needed,
// compare the asking price with RentCast's market estimate, look for rental-scam
// signals, judge San Francisco rent control from the building's year and type,
// and time the commute by bike, foot, or car with Mapbox. No transit routing.

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
const RENTCAST_TYPES = ['Single Family', 'Condo', 'Townhouse', 'Manufactured', 'Multi-Family', 'Apartment'];

export default defineWorkflow<Input, { results: Result[] }>({
  input: { parse: parseInput },
  output: { parse: parseOutput },
  async run(ctx, input) {
    const where = `${input.city}, ${input.state}`;
    let destination: { lat: number; lng: number; name: string } | null = null;
    let destinationError: string | null = null;
    if (input.commute) {
      const to = input.commute.to;
      try {
        destination = fromGeocode(
          await withRetry((occurrence) =>
            ctx.call(
              'geocode',
              'geocode-commute',
              { q: to, limit: 1, country: 'us' },
              { maxChargeCredits: '2', occurrence },
            ),
          ),
        );
        if (!destination) destinationError = `could not find "${to}"`;
      } catch (e) {
        destinationError = `commute destination: ${message(e)}`;
      }
    }

    const results = await ctx.mapRows('listings', input.listings, {
      key: (l) => l.id,
      concurrency: 1,
      async run(row, given): Promise<Result> {
        const call = <T>(binding: string, step: string, args: Record<string, unknown>, max: string) =>
          withRetry((occurrence) => row.call<T>(binding, step, args, { maxChargeCredits: max, occurrence }));
        const l: VetListing = { ...given };
        const errors: string[] = destinationError ? [destinationError] : [];
        let listingStatus: Result['listing_status'] = 'not_checked';

        if (isCraigslist(l.url) && (!l.text || l.lat === null || !l.address || l.price === null || l.beds === null)) {
          try {
            const d = fromCraigslistDetail(await call('detail', 'craigslist-detail', { url: l.url }, '35'));
            for (const k of ['title', 'text', 'address', 'lat', 'lng', 'price', 'beds'] as const) {
              if (l[k] === null || l[k] === undefined) (l as unknown as Record<string, unknown>)[k] = d[k] ?? null;
            }
            listingStatus = 'active';
          } catch (e) {
            listingStatus = 'unavailable';
            errors.push(`craigslist detail (the post may be removed): ${message(e)}`);
          }
        }

        let location: Result['location'] = null;
        if (l.lat !== null && l.lng !== null) location = { lat: l.lat, lng: l.lng, precision: 'listing' };
        const geocode = async (q: string, precision: 'address' | 'area') => {
          try {
            const g = fromGeocode(await call('geocode', `geocode-${precision}`, { q, limit: 1, country: 'us' }, '2'));
            if (g) location = { lat: g.lat, lng: g.lng, precision };
          } catch (e) {
            errors.push(`geocode: ${message(e)}`);
          }
        };
        if (!location && !hasStreetNumber(l.address) && (l.neighborhood || l.address))
          await geocode(`${l.neighborhood ?? l.address}, ${where}`, 'area');

        let market: Result['market'] = null;
        if (l.beds === null) errors.push('bedrooms unknown, so no market estimate');
        else if (hasStreetNumber(l.address) || location) {
          const type =
            RENTCAST_TYPES.find((t) => t.toLowerCase() === (l.property_type ?? '').toLowerCase()) ?? 'Apartment';
          const place: Record<string, unknown> = hasStreetNumber(l.address)
            ? { address: /,/.test(l.address ?? '') ? l.address : `${l.address}, ${where}` }
            : { latitude: location?.lat, longitude: location?.lng };
          try {
            const e = fromEstimate(
              await call(
                'estimate',
                'rent-estimate',
                {
                  ...place,
                  bedrooms: l.beds,
                  ...(l.baths ? { bathrooms: l.baths } : {}),
                  propertyType: type,
                  compCount: 10,
                },
                '45',
              ),
            );
            if (e.estimate)
              market = {
                estimate: e.estimate,
                low: e.low,
                high: e.high,
                comparables: e.comparables,
                price_ratio: l.price ? Math.round((l.price / e.estimate) * 100) / 100 : null,
              };
            if (hasStreetNumber(l.address) && e.lat !== null && e.lng !== null)
              location = { lat: e.lat, lng: e.lng, precision: 'address' };
          } catch (err) {
            errors.push(`rent estimate: ${message(err)}`);
          }
        }
        if (hasStreetNumber(l.address) && location?.precision !== 'address') await geocode(`${l.address}`, 'address');

        const ordinance = mentionsOrdinance([l.title, l.text].filter(Boolean).join('\n'));
        let rentControl: Result['rent_control'] = {
          status: 'not_checked',
          reason: input.rent_control === 'none' ? 'no rent-control rules for this city' : 'no street address',
          year_built: l.year_built,
          year_built_source: l.year_built !== null ? 'listing input' : null,
          property_type: l.property_type,
          units: null,
          mentions_rent_ordinance: ordinance,
        };
        if (input.rent_control === 'san-francisco' && (l.year_built !== null || hasStreetNumber(l.address))) {
          if ((l.year_built === null || !l.property_type) && hasStreetNumber(l.address)) {
            try {
              const p = fromProperties(await call('property', 'property-record', { address: l.address }, '45'));
              if (rentControl.year_built === null && p.year_built !== null)
                rentControl = { ...rentControl, year_built: p.year_built, year_built_source: 'rentcast' };
              rentControl = {
                ...rentControl,
                property_type: rentControl.property_type ?? p.property_type,
                units: p.units,
              };
            } catch (e) {
              errors.push(`property record: ${message(e)}`);
            }
          }
          rentControl = { ...rentControl, ...rentControlSF(rentControl) };
        }

        let commute: Result['commute'] = null;
        if (input.commute && destination && location) {
          const minutes: Partial<Record<Mode, number>> = {};
          for (const mode of input.commute.modes) {
            try {
              const m = fromDirections(
                await call(
                  'directions',
                  `directions-${mode}`,
                  {
                    profile: `mapbox/${mode}`,
                    coordinates: `${location.lng},${location.lat};${destination.lng},${destination.lat}`,
                    overview: 'false',
                  },
                  '3',
                ),
              );
              if (m !== null) minutes[mode] = m;
            } catch (e) {
              errors.push(`directions ${mode}: ${message(e)}`);
            }
          }
          commute = { to: destination.name || input.commute.to, minutes };
        }

        return {
          id: l.id,
          url: l.url,
          title: l.title,
          address: l.address,
          price: l.price,
          beds: l.beds,
          location,
          market,
          scam: scamCheck([l.title, l.text].filter(Boolean).join('\n'), market?.price_ratio ?? null),
          rent_control: rentControl,
          commute,
          listing_status: listingStatus,
          errors,
        };
      },
    });
    return { results };
  },
});
