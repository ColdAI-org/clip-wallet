/** /v1/sync on D1 (Miniflare): signed requests (offline fixtures), compare-and-set, replay, isolation, wipe. */
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, type Env } from "../src/index";
import { SYNC } from "./sync-fixtures";

const E = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
});

type Fx = { method: string; path: string; body: string; authorization: string };

function call(fx: Fx, over: Partial<Fx> = {}, ip = "198.51.100.7") {
  const app = createApp({ now: () => SYNC.NOW });
  const f = { ...fx, ...over };
  return app.fetch(
    new Request(`https://backup.test${f.path}`, {
      method: f.method,
      headers: { authorization: f.authorization, "cf-connecting-ip": ip, ...(f.body ? { "content-type": "application/json" } : {}) },
      ...(f.body ? { body: f.body } : {}),
    }),
    E,
  );
}

describe("settings sync endpoints", () => {
  it("a full round: empty, push, pull, conflict, update, replay, other key, wipe", async () => {
    let r = await call(SYNC.emptyChanges);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ seq: 0, records: [], more: false });
    expect(r.headers.get("cache-control")).toBe("no-store");

    r = await call(SYNC.pushTwo);
    expect(await r.json()).toEqual({ applied: [{ rid: SYNC.rid1, seq: 1 }, { rid: SYNC.rid2, seq: 2 }], conflicts: [] });

    r = await call(SYNC.changesAfterPush);
    const changes = (await r.json()) as { seq: number; records: { rid: string; seq: number; ct: string }[] };
    expect(changes.seq).toBe(2);
    expect(changes.records.map((x) => x.rid)).toEqual([SYNC.rid1, SYNC.rid2]);
    expect(changes.records[0]!.ct).toBe(JSON.parse(SYNC.pushTwo.body).records[0].ct);

    // Compare-and-set: a second "new" write of rid1 conflicts and gets the current row back.
    r = await call(SYNC.pushConflict);
    const c = (await r.json()) as { applied: unknown[]; conflicts: { rid: string; seq: number }[] };
    expect(c.applied).toEqual([]);
    expect(c.conflicts.map((x) => [x.rid, x.seq])).toEqual([[SYNC.rid1, 1]]);

    r = await call(SYNC.pushUpdate);
    expect(((await r.json()) as { applied: { rid: string }[] }).applied.map((x) => x.rid)).toEqual([SYNC.rid1]);

    // The same signed request again is a replay.
    r = await call(SYNC.pushUpdate);
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe("replay");

    // Another sync key sees nothing of this one.
    r = await call(SYNC.otherKeyChanges);
    expect(await r.json()).toEqual({ seq: 0, records: [], more: false });

    // What D1 holds: the hashed key as the space, opaque ids, ciphertext. No plaintext anywhere to find.
    const rows = await E.DB.prepare("SELECT space, rid, seq FROM sync_records").all<{ space: string }>();
    expect(rows.results.every((x) => x.space === SYNC.spaceA)).toBe(true);

    r = await call(SYNC.tooBig);
    expect(r.status).toBe(413);

    r = await call(SYNC.wipe);
    expect(r.status).toBe(204);
    r = await call(SYNC.changesAfterWipe);
    expect(await r.json()).toEqual({ seq: 0, records: [], more: false });
    const left = await E.DB.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE space = ?1").bind(SYNC.spaceA).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it("refuses stale, unsigned, mis-signed and mismatched requests", async () => {
    expect((await call(SYNC.stale)).status).toBe(401);
    expect((await call(SYNC.emptyChanges, { authorization: "" })).status).toBe(401);
    // A valid signature for a GET doesn't authorize a DELETE.
    const r = await call(SYNC.otherKeyChanges, { method: "DELETE", path: "/v1/sync" });
    expect(r.status).toBe(401);
    // Flip one signature character.
    const a = SYNC.changesAfterWipe.authorization;
    const bad = a.slice(0, -3) + (a.at(-3) === "A" ? "B" : "A") + a.slice(-2);
    expect((await call(SYNC.changesAfterWipe, { authorization: bad })).status).toBe(401);
  });

  it("rate-limits per IP before any signature work", async () => {
    const app = createApp({ now: () => SYNC.NOW });
    const ip = "198.51.100.250";
    let last = 0;
    for (let i = 0; i < 2001; i++) {
      const res = await app.fetch(new Request("https://backup.test/v1/sync/changes?since=0", { headers: { "cf-connecting-ip": ip } }), E);
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
