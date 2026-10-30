import { describe, expect, it } from "vitest";
import { parseMetaplexMetadata } from "../src/index.js";
import { b64decode } from "../src/util.js";
import { metaplexData } from "./helpers.js";

describe("parseMetaplexMetadata", () => {
  it("drops the NUL padding after each string, and only at the end", () => {
    const parsed = parseMetaplexMetadata(b64decode(metaplexData(new Uint8Array(32), "Mad Lad #7", "MAD", "https://meta.example/7.json")));
    expect(parsed).toEqual({ name: "Mad Lad #7", symbol: "MAD", uri: "https://meta.example/7.json", collection: null });
    expect(parseMetaplexMetadata(b64decode(metaplexData(new Uint8Array(32), "A\0B", "S", "u")))?.name).toBe("A\0B");
  });
});
