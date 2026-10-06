export function requiredAgreement(swarmSize: number, threshold: number): number {
  const votes = swarmSize * threshold;
  return Math.ceil(votes - Number.EPSILON * Math.max(1, votes));
}
