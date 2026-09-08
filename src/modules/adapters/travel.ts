import { sql } from '@/lib/db';

/**
 * TravelTimeProvider (§13, §24.2, MATCH-02)
 *
 * MATCH-02 forbids straight-line distance as the sole metric. In production
 * this adapter is backed by Google Maps or Mapbox; for the prototype it is a
 * seeded Pune locality centroid table plus haversine and a road-circuity
 * factor. That keeps the demo at zero cost and — more importantly — keeps it
 * deterministic, which §21.2 requires anyway.
 *
 * Swapping in a real provider means implementing this interface. Nothing in
 * the matching engine knows which one it is talking to.
 */
export interface TravelEstimate {
  km: number;
  minutes: number;
  provider: string;
  band: 'CLOSE' | 'MODERATE' | 'LONG' | 'VERY_LONG';
}

export interface TravelTimeProvider {
  readonly name: string;
  between(fromLocality: string, toLat: number, toLng: number): Promise<TravelEstimate>;
}

const EARTH_KM = 6371;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Pune-calibrated constants.
 * Road circuity: straight-line × 1.35 approximates actual road distance in a
 * city with a river and a cantonment breaking the grid.
 * Effective speed: 18 km/h is realistic for two-wheeler/bus commuting in
 * Pune peak hours, which is when a frontline shift starts.
 */
const ROAD_FACTOR = 1.35;
const EFFECTIVE_KMPH = 18;

function bandFor(minutes: number): TravelEstimate['band'] {
  if (minutes <= 20) return 'CLOSE';
  if (minutes <= 40) return 'MODERATE';
  if (minutes <= 70) return 'LONG';
  return 'VERY_LONG';
}

export class SeededMatrixTravelProvider implements TravelTimeProvider {
  readonly name = 'seeded-pune-matrix@1.0';

  async between(fromLocality: string, toLat: number, toLng: number): Promise<TravelEstimate> {
    const [origin] = await sql<{ lat: number; lng: number }[]>`
      SELECT lat, lng FROM app.locality WHERE key = ${fromLocality}
    `;
    if (!origin) {
      return { km: 0, minutes: 999, provider: this.name, band: 'VERY_LONG' };
    }
    const straight = haversineKm(origin.lat, origin.lng, toLat, toLng);
    const km = Math.round(straight * ROAD_FACTOR * 10) / 10;
    const minutes = Math.max(5, Math.round((km / EFFECTIVE_KMPH) * 60));
    return { km, minutes, provider: this.name, band: bandFor(minutes) };
  }
}

/**
 * Placeholder for the MVP. Deliberately throws rather than silently falling
 * back, so nobody ships a build that quietly costs money per request.
 */
export class GoogleMapsTravelProvider implements TravelTimeProvider {
  readonly name = 'google-distance-matrix';
  async between(): Promise<TravelEstimate> {
    throw new Error(
      'GoogleMapsTravelProvider requires a billed Google Cloud account. ' +
      'Set TRAVEL_PROVIDER=seeded for the zero-cost prototype.',
    );
  }
}

export function travelProvider(): TravelTimeProvider {
  return process.env.TRAVEL_PROVIDER === 'google'
    ? new GoogleMapsTravelProvider()
    : new SeededMatrixTravelProvider();
}
