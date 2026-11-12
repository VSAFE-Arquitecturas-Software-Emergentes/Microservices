import { randomUUID } from 'node:crypto';
import { Problem, Point, RouteAlternative, RiskEstimate } from '@vsafe/contracts';
import { internalFetch } from '@vsafe/platform';
import { RouteProvider, RiskPort } from '../application/ports';
export class MapboxProvider implements RouteProvider {
  private failures = 0;
  private openUntil = 0;
  async alternatives(origin: Point, destination: Point): Promise<Omit<RouteAlternative, 'risk'>[]> {
    if (process.env.DATA_MODE === 'demo') {
      const dx = destination.lng - origin.lng,
        dy = destination.lat - origin.lat;
      return [0, 1, -1].map((n, i) => {
        const coords: [number, number][] = [
          [origin.lng, origin.lat],
          [origin.lng + dx * 0.32 - dy * 0.15 * n, origin.lat + dy * 0.32 + dx * 0.15 * n],
          [origin.lng + dx * 0.68 - dy * 0.12 * n, origin.lat + dy * 0.68 + dx * 0.12 * n],
          [destination.lng, destination.lat],
        ];
        const distance = Math.round(Math.hypot(dx * 108000, dy * 111000) * (1.12 + i * 0.09));
        return {
          id: randomUUID(),
          label: `${i + 1}`,
          geometry: { type: 'LineString', coordinates: coords },
          distance,
          duration: Math.round(distance / (1.3 - i * 0.08)),
          demo: true,
        };
      });
    }
    if (!process.env.MAPBOX_ACCESS_TOKEN) throw new Problem(503, 'MAPBOX_NOT_CONFIGURED');
    if (Date.now() < this.openUntil) throw new Problem(503, 'PROVIDER_CIRCUIT_OPEN');
    try {
      const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?alternatives=true&geometries=geojson&overview=full&access_token=${encodeURIComponent(process.env.MAPBOX_ACCESS_TOKEN)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error('MAPBOX_FAILURE');
      const data = (await res.json()) as {
        routes: { geometry: RouteAlternative['geometry']; distance: number; duration: number }[];
      };
      if (!data.routes?.length) throw new Problem(422, 'NO_ROUTES');
      this.failures = 0;
      return data.routes
        .slice(0, 3)
        .map((r, i) => ({ ...r, id: randomUUID(), label: String(i + 1), demo: false }));
    } catch (e) {
      if (e instanceof Problem) throw e;
      if (++this.failures >= 5) this.openUntil = Date.now() + 30_000;
      throw new Problem(503, 'PROVIDER_UNAVAILABLE');
    }
  }
}
export class HttpRiskAdapter implements RiskPort {
  assess(routes: Parameters<RiskPort['assess']>[0]) {
    return internalFetch<Record<string, RiskEstimate>>(
      `${process.env.RISK_ASSESSMENT_URL}/internal/v1/risk-assessments`,
      'risk-assessment',
      'route-planning',
      { method: 'POST', body: JSON.stringify({ routes }) },
      1000,
    );
  }
}
