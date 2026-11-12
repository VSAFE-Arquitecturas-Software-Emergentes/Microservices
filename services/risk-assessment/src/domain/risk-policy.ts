export interface EvidenceCoverage {
  samples: number;
  ratio: number;
  syncedAt: number;
  validatedModel: boolean;
}
export class RiskPolicy {
  static unknownCause(e: EvidenceCoverage, now = Date.now()): string | null {
    if (!e.validatedModel) return 'MODEL_NOT_VALIDATED';
    if (now - e.syncedAt > 60_000) return 'STALE_PROJECTION';
    if (e.samples < 3) return 'INSUFFICIENT_SAMPLES';
    if (e.ratio < 0.5) return 'INSUFFICIENT_COVERAGE';
    return null;
  }
  static level(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    return score < 0.35 ? 'LOW' : score < 0.65 ? 'MEDIUM' : 'HIGH';
  }
  static features(samples: number, severe: number, recent: number, hour: number, coverage: number) {
    return [
      Math.min(samples / 15, 1),
      severe / Math.max(samples, 1),
      recent / Math.max(samples, 1),
      hour < 6 || hour >= 20 ? 1 : 0,
      coverage,
    ];
  }
}
