import type { Point, RouteAlternative, RiskEstimate, Journey, Geometry } from '@vsafe/contracts';
import type { Progress } from '../domain/journey';
export interface RouteProvider {
  alternatives(origin: Point, destination: Point): Promise<Omit<RouteAlternative, 'risk'>[]>;
}
export interface RiskPort {
  assess(routes: { id: string; geometry: Geometry }[]): Promise<Record<string, RiskEstimate>>;
}
export interface JourneyRepository {
  saveOptions(owner: string, routes: RouteAlternative[]): Promise<void>;
  start(owner: string, alternativeId: string, key: string): Promise<Journey>;
  find(id: string, owner?: string): Promise<(Journey & { ownerRef: string }) | null>;
  change(
    owner: string,
    id: string,
    expectedVersion: number,
    alternativeId: string,
  ): Promise<Journey>;
  progress(owner: string, id: string, version: number, progress: Progress): Promise<void>;
  close(owner: string, id: string): Promise<void>;
  purge(): Promise<void>;
}
