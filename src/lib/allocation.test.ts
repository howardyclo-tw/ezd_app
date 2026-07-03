import { describe, it, expect } from "vitest";
import { allocate, type AllocationCandidate } from "./allocation";

describe("allocate (fcfs)", () => {
  const policy = "fcfs" as const;

  it("grants earliest enrolledAt first, denies the rest", () => {
    const candidates: AllocationCandidate[] = [
      { enrollmentId: "c", enrolledAt: "2026-01-03T00:00:00Z" },
      { enrollmentId: "a", enrolledAt: "2026-01-01T00:00:00Z" },
      { enrollmentId: "b", enrolledAt: "2026-01-02T00:00:00Z" },
    ];
    const result = allocate(candidates, 2, policy);
    expect(result.granted).toEqual(["a", "b"]);
    expect(result.denied).toEqual(["c"]);
  });

  it("grants all when capacity >= candidates.length", () => {
    const candidates: AllocationCandidate[] = [
      { enrollmentId: "x", enrolledAt: "2026-01-02T00:00:00Z" },
      { enrollmentId: "y", enrolledAt: "2026-01-01T00:00:00Z" },
    ];
    const result = allocate(candidates, 5, policy);
    expect(result.granted).toEqual(["y", "x"]);
    expect(result.denied).toEqual([]);
  });

  it("denies all when capacity is 0", () => {
    const candidates: AllocationCandidate[] = [
      { enrollmentId: "a", enrolledAt: "2026-01-01T00:00:00Z" },
      { enrollmentId: "b", enrolledAt: "2026-01-02T00:00:00Z" },
    ];
    const result = allocate(candidates, 0, policy);
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual(["a", "b"]);
  });

  it("handles empty candidates", () => {
    const result = allocate([], 5, policy);
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual([]);
  });

  it("breaks ties deterministically by enrollmentId", () => {
    const candidates: AllocationCandidate[] = [
      { enrollmentId: "zebra", enrolledAt: "2026-01-01T00:00:00Z" },
      { enrollmentId: "alpha", enrolledAt: "2026-01-01T00:00:00Z" },
      { enrollmentId: "mango", enrolledAt: "2026-01-01T00:00:00Z" },
    ];
    const result = allocate(candidates, 2, policy);
    // alphabetical tie-break: alpha < mango < zebra
    expect(result.granted).toEqual(["alpha", "mango"]);
    expect(result.denied).toEqual(["zebra"]);
  });

  it("returns disjoint granted/denied covering all input ids", () => {
    const candidates: AllocationCandidate[] = [
      { enrollmentId: "a", enrolledAt: "2026-01-01T00:00:00Z" },
      { enrollmentId: "b", enrolledAt: "2026-01-02T00:00:00Z" },
      { enrollmentId: "c", enrolledAt: "2026-01-03T00:00:00Z" },
      { enrollmentId: "d", enrolledAt: "2026-01-04T00:00:00Z" },
    ];
    const result = allocate(candidates, 2, policy);
    const allIds = [...result.granted, ...result.denied].sort();
    const inputIds = candidates.map((c) => c.enrollmentId).sort();
    expect(allIds).toEqual(inputIds);
    // disjoint: no overlap
    const overlap = result.granted.filter((id) => result.denied.includes(id));
    expect(overlap).toEqual([]);
  });

  it("handles negative capacity same as 0", () => {
    const candidates: AllocationCandidate[] = [
      { enrollmentId: "a", enrolledAt: "2026-01-01T00:00:00Z" },
    ];
    const result = allocate(candidates, -1, policy);
    expect(result.granted).toEqual([]);
    expect(result.denied).toEqual(["a"]);
  });
});
