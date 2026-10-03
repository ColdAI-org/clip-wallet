import { describe, expect, it } from "vitest";
import { BACKUP_PRF_INPUT } from "../src/platform.js";

describe("BACKUP_PRF_INPUT", () => {
  // Must equal @clip-wallet/vault's BACKUP_PRF_INPUT (packages/vault/test/vault.test.ts pins the same hex).
  it("matches the vault's value", () => {
    expect(Buffer.from(BACKUP_PRF_INPUT).toString("hex")).toBe("160feec3b9d9d1ace9480314d3219d71223fd9ca5f9f6e93e7996fb123ab43cf");
  });
});
