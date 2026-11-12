export function targetFor(path: string): string | null {
  if (/^\/api\/v1\/journeys\/[a-f0-9-]+\/alerts(?:\/stream|\/[a-f0-9-]+\/ack)$/.test(path))
    return 'journey-alerts';
  if (/^\/api\/v1\/(routes\/search|journeys(?:\/[a-f0-9-]+(?:\/(route|progress))?)?)$/.test(path))
    return 'route-planning';
  if (/^\/api\/v1\/(incident-reports(?:\/[a-f0-9-]+(?:\/audit)?)?|incidents)$/.test(path))
    return 'incident-reporting';
  return null;
}
