import { describe, expect, it } from "vitest";
import { noticeTarget } from "../src/lib/notice-routes";

describe("noticeTarget", () => {
  it("maps notice routes to screens", () => {
    expect(noticeTarget("/approval/abc%201")).toEqual({ kind: "approval", id: "abc 1" });
    expect(noticeTarget("/asset/eth")).toEqual({ kind: "asset", key: "eth" });
    expect(noticeTarget("/activity")).toEqual({ kind: "activity" });
    expect(noticeTarget("/collectible/x")).toEqual({ kind: "collectibles" });
    expect(noticeTarget("/")).toEqual({ kind: "home" });
    expect(noticeTarget("/approval")).toEqual({ kind: "home" });
    expect(noticeTarget("nonsense")).toEqual({ kind: "home" });
  });
});
