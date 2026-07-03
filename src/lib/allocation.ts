export type AllocationPolicy = "fcfs";

export interface AllocationCandidate {
  enrollmentId: string;
  enrolledAt: string;
}

export interface AllocationResult {
  granted: string[];
  denied: string[];
}

/**
 * Allocate seats to candidates according to the given policy.
 *
 * @param candidates - list of enrollment candidates
 * @param capacity   - number of seats to grant (clamped to >= 0)
 * @param policy     - allocation strategy; currently only "fcfs"
 * @returns granted and denied enrollmentId arrays (disjoint, covering all input)
 */
export function allocate(
  candidates: AllocationCandidate[],
  capacity: number,
  policy: AllocationPolicy,
): AllocationResult {
  switch (policy) {
    case "fcfs":
      return allocateFcfs(candidates, capacity);
    default: {
      // Exhaustive check — adding a new policy to the union
      // without a case here will cause a compile error.
      const _exhaustive: never = policy;
      throw new Error(`Unknown allocation policy: ${_exhaustive}`);
    }
  }
}

function allocateFcfs(
  candidates: AllocationCandidate[],
  capacity: number,
): AllocationResult {
  const effectiveCap = Math.max(0, capacity);

  const sorted = [...candidates].sort((a, b) => {
    const timeDiff = a.enrolledAt.localeCompare(b.enrolledAt);
    if (timeDiff !== 0) return timeDiff;
    return a.enrollmentId.localeCompare(b.enrollmentId);
  });

  const granted = sorted.slice(0, effectiveCap).map((c) => c.enrollmentId);
  const denied = sorted.slice(effectiveCap).map((c) => c.enrollmentId);

  return { granted, denied };
}
