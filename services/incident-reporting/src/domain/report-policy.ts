export class ReportPolicy {
  static readonly hours: Record<string, number> = {
    THEFT: 6,
    ASSAULT: 6,
    HARASSMENT: 4,
    OBSTRUCTION: 2,
  };
  static validObservation(observedAt: string, now = Date.now()) {
    const t = Date.parse(observedAt);
    return Number.isFinite(t) && t <= now + 60_000 && t >= now - 24 * 3600_000;
  }
  static expiresAt(category: string, observedAt: string) {
    return new Date(Date.parse(observedAt) + this.hours[category] * 3600_000);
  }
  static approximate(p: { lat: number; lng: number }) {
    return { lat: Math.round(p.lat * 10000) / 10000, lng: Math.round(p.lng * 10000) / 10000 };
  }
}
