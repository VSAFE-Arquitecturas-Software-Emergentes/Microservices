export interface Progress {
  segmentIndex: number;
  fractionAlong: number;
  observedAt: string;
}
export class JourneyPolicy {
  static canChange(status: string, actualVersion: number, expectedVersion: number) {
    return status === 'ACTIVE' && actualVersion === expectedVersion;
  }
  static validProgress(progress: Progress, segments: number, now = Date.now()) {
    return (
      Number.isInteger(progress.segmentIndex) &&
      progress.segmentIndex >= 0 &&
      progress.segmentIndex < segments &&
      progress.fractionAlong >= 0 &&
      progress.fractionAlong <= 1 &&
      Date.parse(progress.observedAt) >= now - 60_000 &&
      Date.parse(progress.observedAt) <= now + 5_000
    );
  }
  static remaining(coordinates: [number, number][], progress: Progress | null): [number, number][] {
    if (!progress) return coordinates;
    const i = progress.segmentIndex;
    const a = coordinates[i],
      b = coordinates[i + 1];
    if (!a || !b) return coordinates;
    return [
      [
        a[0] + (b[0] - a[0]) * progress.fractionAlong,
        a[1] + (b[1] - a[1]) * progress.fractionAlong,
      ],
      ...coordinates.slice(i + 1),
    ];
  }
}
