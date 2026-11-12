import type { Geometry, RiskEstimate, IntegrationEvent } from '@vsafe/contracts';
import { RiskPolicy } from '../domain/risk-policy';
import { RiskAssessmentAggregate } from '../domain/risk-assessment';
export interface EvidenceRepository {
  evidence(geometry: Geometry): Promise<{
    samples: number;
    severe: number;
    recent: number;
    coverage: number;
    syncedAt: number;
  }>;
  apply(event: IntegrationEvent): Promise<void>;
  reconcile(): Promise<void>;
  saveMetadata(results: Record<string, RiskEstimate>): Promise<void>;
}
export interface InferencePort {
  predict(features: number[]): Promise<number>;
  metadata(): { version: string; validated: boolean; synthetic: boolean };
}
export class RiskService {
  constructor(
    private readonly repo: EvidenceRepository,
    private readonly inference: InferencePort,
    private readonly allowSynthetic = false,
  ) {}
  async assess(routes: { id: string; geometry: Geometry }[]) {
    const model = this.inference.metadata();
    const assessment = new RiskAssessmentAggregate<RiskEstimate>(model.version);
    for (const route of routes) {
      const e = await this.repo.evidence(route.geometry);
      let cause = RiskPolicy.unknownCause({
        samples: e.samples,
        ratio: e.coverage,
        syncedAt: e.syncedAt,
        validatedModel: model.validated && (!model.synthetic || this.allowSynthetic),
      });
      let score: number | null = null;
      if (!cause)
        try {
          score = await this.inference.predict(
            RiskPolicy.features(
              e.samples,
              e.severe,
              e.recent,
              (new Date().getUTCHours() - 5 + 24) % 24,
              e.coverage,
            ),
          );
          if (!Number.isFinite(score) || score < 0 || score > 1)
            throw new Error('INVALID_INFERENCE');
        } catch {
          cause = 'INFERENCE_FAILED';
          score = null;
        }
      assessment.add(route.id, {
        level: cause ? 'UNKNOWN' : RiskPolicy.level(score!),
        score,
        cause,
        coverage: e.coverage,
        sampleCount: e.samples,
        methodVersion: model.version,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        demo: model.synthetic,
      });
    }
    const results = assessment.complete(routes.length);
    await this.repo.saveMetadata(results);
    return results;
  }
}
