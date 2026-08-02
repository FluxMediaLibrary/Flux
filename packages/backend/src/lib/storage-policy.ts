export interface RootCapacity {
  root: string;
  freeBytes: number;
}

export function chooseMediaRoot(
  capacities: readonly RootCapacity[],
  requiredBytes: number,
  reserveSpaceBytes: number,
): string | null {
  const incoming = Math.max(0, requiredBytes);
  const reserve = Math.max(0, reserveSpaceBytes);
  const safe = capacities.find((candidate) => candidate.freeBytes - incoming >= reserve);
  if (safe) return safe.root;
  const viable = capacities.filter((candidate) => candidate.freeBytes >= incoming);
  if (viable.length === 0) return null;
  return viable.reduce(
    (best, candidate) => candidate.freeBytes > best.freeBytes ? candidate : best,
    viable[0]!,
  ).root;
}
