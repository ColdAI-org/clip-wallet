import { describe, expect, it } from "vitest";
import { compareClocks, localWrite, mergeRecords, type SyncRecord } from "../src/sync/records.js";

const rec = (v: unknown, clock: Record<string, number>, t: number, d: string): SyncRecord => ({ c: "prefs", id: "locale", v, clock, t, d });

describe("vector clocks", () => {
  it("orders clocks", () => {
    expect(compareClocks({ a: 1 }, { a: 2 })).toBe("before");
    expect(compareClocks({ a: 2, b: 1 }, { a: 2 })).toBe("after");
    expect(compareClocks({ a: 1 }, { b: 1 })).toBe("concurrent");
    expect(compareClocks({ a: 1, b: 0 }, { a: 1 })).toBe("equal");
  });

  it("a dominating write wins even if its wall clock is older (no lost updates from a slow clock)", () => {
    const base = rec("de", { a: 1 }, 1000, "a");
    const later = rec("fr", { a: 1, b: 1 }, 500, "b"); // b saw a's write, then wrote with a slow clock
    expect(mergeRecords(base, later).v).toBe("fr");
    expect(mergeRecords(later, base).v).toBe("fr");
  });

  it("concurrent writes: the later wall clock wins, then the device id; the merged clock covers both", () => {
    const x = rec("de", { a: 2 }, 2000, "a");
    const y = rec("fr", { a: 1, b: 1 }, 3000, "b");
    const m = mergeRecords(x, y);
    expect(m.v).toBe("fr");
    expect(m.clock).toEqual({ a: 2, b: 1 });
    const tie1 = rec("x", { a: 1 }, 5, "a");
    const tie2 = rec("y", { b: 1 }, 5, "b");
    expect(mergeRecords(tie1, tie2).v).toBe("y");
    expect(mergeRecords(tie2, tie1).v).toBe("y");
  });

  it("merge is commutative, associative and idempotent (every device converges)", () => {
    const rs = [
      rec("a", { a: 1 }, 10, "a"),
      rec("b", { b: 1 }, 12, "b"),
      rec("c", { a: 1, c: 1 }, 11, "c"),
      rec(null, { a: 2, b: 1 }, 9, "a"),
      rec("e", { d: 3 }, 12, "d"),
    ];
    const perms = (xs: SyncRecord[]): SyncRecord[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
    const results = new Set(perms(rs).map((p) => JSON.stringify(p.reduce((acc, r) => mergeRecords(acc, r)))));
    expect(results.size).toBe(1);
    for (const r of rs) expect(mergeRecords(r, r)).toEqual(r);
  });

  it("local writes bump this device's counter and never go back in time", () => {
    const w1 = localWrite(undefined, "prefs", "locale", "de", "dev1", 100);
    const w2 = localWrite(w1, "prefs", "locale", "fr", "dev1", 50);
    expect(w2.clock).toEqual({ dev1: 2 });
    expect(w2.t).toBe(101);
    expect(compareClocks(w1.clock, w2.clock)).toBe("before");
  });
});
