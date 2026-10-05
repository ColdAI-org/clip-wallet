/**
 * Background text (approval titles, labels, warnings, errors, activity, steps) in every language: the "bg.*"
 * catalog in @clip-wallet/core and how the UI renders it.
 */
import { describe, expect, it } from "vitest";
import {
  BG_LOCALE_LOADERS,
  BG_MESSAGES,
  BG_MESSAGE_PARTS,
  ClipError,
  ERROR_CATEGORIES,
  WARNING_CODES,
  WARNING_DEFAULT_IDS,
  activityTitleMsg,
  attachMsgs,
  errorCategoryId,
  errorMsg,
  fillTemplate,
  knownMsg,
  loadBgMessages,
  msg,
  recallMsg,
  say,
  sanitizeDecoded,
  unverifiedLabel,
  UNVERIFIED_ORIGIN_SUFFIX,
  titleMsgOf,
  warningMsg,
  type BgTranslation,
  type DecodedRequest,
  type Warning,
} from "@clip-wallet/core";
import { LOCALE_CODES, checkTranslation, formatMsg, parseMessage } from "@clip-wallet/i18n";
import { GLOSSARIES, checkGlossary, lintCatalog, unisolatedArguments } from "@clip-wallet/i18n/qa";
import { PROTECTED_TERMS } from "../src/i18n";

const EN = BG_MESSAGES as Record<string, string>;
const OTHER = LOCALE_CODES.filter((c) => c !== "en");
const EN_FOR_GLOSSARY = Object.fromEntries(Object.entries(EN).map(([id, m]) => [id, m.replace(/Clip Wallet/g, "{brand}")]));

describe("bg catalog (English)", () => {
  it("every id is namespaced and every message uses plain arguments only", () => {
    for (const [id, m] of Object.entries(EN)) {
      expect(id).toMatch(/^bg\.[A-Za-z0-9.]+$/);
      const nodes = parseMessage(m) as { t: string }[];
      expect(nodes.every((n) => n.t === "text" || n.t === "arg"), id).toBe(true);
    }
  });

  it("no part replaces another part's id", () => {
    const total = Object.values(BG_MESSAGE_PARTS).reduce((n, p) => n + Object.keys(p).length, 0);
    expect(Object.keys(EN)).toHaveLength(total);
  });

  it("fillTemplate renders the English exactly like the ICU formatter", () => {
    for (const [id, m] of Object.entries(EN)) {
      const values = Object.fromEntries([...m.matchAll(/\{(\w+)\}/g)].map((x) => [x[1]!, `<${x[1]}>`]));
      expect(fillTemplate(m, values), id).toBe(formatMsg({ id, values, fallback: "" }, { [id]: m }, "de"));
    }
  });

  it("every Warning code and every error kind has a general message", () => {
    for (const code of WARNING_CODES) expect(EN[WARNING_DEFAULT_IDS[code]], code).toBeTruthy();
    for (const c of ERROR_CATEGORIES) expect(EN[c.id], c.id).toBeTruthy();
  });

  it("every shipped language has a loader", () => {
    expect(Object.keys(BG_LOCALE_LOADERS).sort()).toEqual([...OTHER].sort());
  });
});

describe("bg translations", () => {
  for (const code of OTHER) {
    it(`${code}: complete, same variables, protected terms kept, parses and renders, follows the glossary`, async () => {
      const cat = (await loadBgMessages(code)) as Record<string, string>;
      expect(checkTranslation(EN, cat, code, PROTECTED_TERMS)).toEqual([]);
      expect(lintCatalog(EN, cat, code)).toEqual([]);
      // "Clip Wallet" is the brand (kept verbatim), not the word "wallet".
      expect(checkGlossary(EN_FOR_GLOSSARY, cat, code, GLOSSARIES[code])).toEqual([]);
      // Untranslated copies of English sentences would be missed translations (short labels like "NFT" may stay).
      const same = Object.entries(EN).filter(([id, m]) => cat[id] === m && /[a-z]{3,} [a-z]{3,}/.test(m));
      expect(same.map(([id]) => id)).toEqual([]);
    });

    it(`${code}: every Warning code's general message is translated`, async () => {
      const cat = (await loadBgMessages(code)) as BgTranslation;
      for (const w of WARNING_CODES) {
        const id = WARNING_DEFAULT_IDS[w];
        expect(cat[id], `${code} ${w}`).toBeTruthy();
        expect(cat[id], `${code} ${w}`).not.toBe(EN[id]);
      }
    });
  }

  it("ar: every interpolated value sits in a bidi isolate", async () => {
    const ar = (await loadBgMessages("ar")) as Record<string, string>;
    expect(Object.entries(ar).flatMap(([id, m]) => unisolatedArguments(m).map((a) => `${id}: ${a}`))).toEqual([]);
  });
});

describe("Msg contract", () => {
  it("msg() keeps the module's English as the fallback", () => {
    const m = msg("bg.req.sendTo", { amount: "1.5 ETH", to: "0x12…ab" });
    expect(m).toEqual({ id: "bg.req.sendTo", values: { amount: "1.5 ETH", to: "0x12…ab" }, fallback: "Send 1.5 ETH to 0x12…ab" });
  });

  it("renders in the locale, English shows the fallback, unknown ids and missing catalogs fall back", async () => {
    const de = (await loadBgMessages("de")) as Record<string, string>;
    const m = msg("bg.req.signMessage", { host: "app.example" });
    expect(formatMsg(m, de, "en")).toBe("Sign a message for app.example");
    expect(formatMsg(m, de, "de")).toContain("app.example");
    expect(formatMsg(m, de, "de")).not.toBe(m.fallback);
    expect(formatMsg({ id: "bg.nope", fallback: "Plain" }, de, "de")).toBe("Plain");
    expect(formatMsg(m, undefined, "de")).toBe(m.fallback);
  });

  it("nested Msgs render in the same language", async () => {
    const ja = (await loadBgMessages("ja")) as Record<string, string>;
    const inner = msg("bg.req.stake", { amount: "5 HBAR" });
    const outer = msg("bg.req.schedule", { inner });
    expect(outer.fallback).toBe("Schedule: Stake 5 HBAR");
    expect(formatMsg(outer, ja, "ja")).toContain(formatMsg(inner, ja, "ja"));
  });

  it("fixed sentences are known by exact text only", () => {
    expect(knownMsg("Network fee")?.id).toBe("bg.label.networkFee");
    expect(knownMsg("This transaction can't be read.")?.id).toBe("bg.err.txUnreadable");
    expect(knownMsg("Network fee ")).toBeUndefined();
    expect(titleMsgOf({ title: "Approve a transaction" })?.id).toBe("bg.req.approveTx");
  });

  it("ClipError carries a Msg: given, or its exact sentence", () => {
    const a = new ClipError(msg("bg.err.notEnough", { symbol: "USDC" }), "near/insufficient-token");
    expect(a.userMessage).toBe("You don't have enough USDC.");
    expect(a.msg?.id).toBe("bg.err.notEnough");
    expect(new ClipError("That's your own address.", "x/self-transfer").msg?.id).toBe("bg.err.ownAddress");
    expect(new ClipError("Something nobody wrote down.", "x/y").msg).toBeUndefined();
  });

  it("errors without a Msg get their kind's general message (approx), else none", () => {
    expect(errorCategoryId("near/insufficient-funds")).toBe("bg.err.cat.insufficient");
    expect(errorCategoryId("user-rejected")).toBe("bg.err.declined");
    const m = errorMsg({ userMessage: "You don't have enough NEAR to stake that much (keep a little for fees).", code: "near/insufficient-funds" });
    expect(m).toMatchObject({ id: "bg.err.cat.insufficient", approx: true });
    expect(errorMsg({ userMessage: "Odd.", code: "x/odd" })).toBeUndefined();
    // A Msg that crossed the bus is shape-checked.
    expect(errorMsg({ userMessage: "x", code: "c", msg: { id: 3 } })).toBeUndefined();
  });

  it("warnings: own Msg, exact sentence, else the code's general message with the English kept", () => {
    const m = msg("bg.warn.letsTakeAll", { spender: "X", symbol: "USDC" });
    const own: Warning = { level: "danger", code: "unlimited-approval", message: m.fallback, msg: m };
    expect(warningMsg(own).id).toBe("bg.warn.letsTakeAll");
    // A Msg that no longer matches its message (someone rewrote the text) is ignored.
    expect(warningMsg({ ...own, message: "Rewritten." }).id).toBe("bg.warn.unlimitedApproval");
    expect(warningMsg({ code: "blind-signing", message: "Clip Wallet can't read this request." }).id).toBe("bg.warn.cantReadRequest");
    const general = warningMsg({ code: "memo-required", message: "GABC needs a memo." });
    expect(general).toEqual({ id: "bg.warn.memoRequired", fallback: "GABC needs a memo.", approx: true });
  });

  it("say() + attachMsgs: titles, numbered labels and warnings built as strings get their Msg back; a dapp's message text never", () => {
    const title = say("bg.req.unstakeFrom", { amount: "2 NEAR", validator: "pool.near" });
    const warn = say("bg.near.noAccountFails", { account: "bob.near" });
    const input: Pick<DecodedRequest, "title" | "titleMsg" | "lines" | "warnings"> = {
      title,
      lines: [
        { label: say("bg.label.actionN", { n: 2 }), value: title },
        { label: "Message", value: title },
      ],
      warnings: [{ level: "danger", code: "new-recipient", message: warn }],
    };
    const d = attachMsgs(input);
    expect(d.titleMsg?.id).toBe("bg.req.unstakeFrom");
    expect(d.lines[0]!.labelMsg?.id).toBe("bg.label.actionN");
    expect(d.lines[0]!.valueMsg?.id).toBe("bg.req.unstakeFrom");
    expect(d.lines[1]!.valueMsg).toBeUndefined();
    expect(d.warnings[0]!.msg?.id).toBe("bg.near.noAccountFails");
    expect(recallMsg("never said")).toBeUndefined();
  });

  it("activity titles follow the approval's Msg", () => {
    const send = msg("bg.req.sendTo", { amount: "1 ETH", to: "0x12…ab" });
    expect(activityTitleMsg({ title: send.fallback, titleMsg: send }, { name: "Clip Wallet" }, "Sent 1 ETH to 0x12…ab x")).toMatchObject({ id: "bg.act.sent", fallback: "Sent 1 ETH to 0x12…ab x" });
    const swap = msg("bg.req.swap", { pay: "1 HBAR", get: "~5 SAUCE" });
    expect(activityTitleMsg({ title: swap.fallback, titleMsg: swap }, { name: "SaucerSwap" }, "Approved: Swap 1 HBAR for ~5 SAUCE")?.values?.what).toEqual(swap);
    expect(activityTitleMsg({ title: "Something custom" }, { name: "x" }, "Approved: Something custom")).toBeUndefined();
  });
});

describe("audit additions", () => {
  it("sanitizeDecoded keeps the Msgs and makes their text display-safe too", () => {
    const evil = "Uni‮swap";
    const title = msg("bg.req.allowSpendAll", { spender: evil, symbol: "USDC" });
    const label = msg("bg.label.actionN", { n: 1 });
    const value = msg("bg.req.stake", { amount: "1​ SOL" });
    const w = msg("bg.warn.letsTakeAll", { spender: evil, symbol: "USDC" });
    const d = sanitizeDecoded({
      requestId: "r",
      networkId: "n",
      title: title.fallback,
      titleMsg: title,
      lines: [{ label: label.fallback, labelMsg: label, value: value.fallback, valueMsg: value }],
      balanceChanges: [],
      simulated: false,
      blind: false,
      warnings: [{ level: "danger", code: "unlimited-approval", message: w.fallback, msg: w }],
    });
    expect(d.titleMsg?.values?.spender).toBe("Uniswap");
    expect(d.titleMsg?.fallback).toBe(d.title);
    expect(titleMsgOf(d)?.id).toBe("bg.req.allowSpendAll");
    expect(d.lines[0]!.labelMsg?.id).toBe("bg.label.actionN");
    expect(d.lines[0]!.valueMsg?.fallback).toBe(d.lines[0]!.value);
    expect(d.lines[0]!.valueMsg?.values?.amount).toBe("1 SOL");
    expect(warningMsg(d.warnings[0]!).id).toBe("bg.warn.letsTakeAll");
    expect(JSON.stringify(d)).not.toMatch(/[‮​]/);
  });

  it("unverified hosts translate inside titles; unknown-call and the new labels have messages", () => {
    const host = unverifiedLabel(`app.example${UNVERIFIED_ORIGIN_SUFFIX}`)!;
    expect(host).toBe("app.example (unverified)");
    const input: Pick<DecodedRequest, "title" | "titleMsg" | "lines" | "warnings"> = { title: say("bg.req.signMessage", { host }), lines: [], warnings: [] };
    const d = attachMsgs(input);
    expect(d.titleMsg?.values?.host).toMatchObject({ id: "bg.label.hostUnverified", values: { host: "app.example" } });
    expect(WARNING_DEFAULT_IDS["unknown-call"]).toBe("bg.warn.unknownCall");
    expect(knownMsg("Network fee at most")?.id).toBe("bg.label.networkFeeAtMost");
    expect(knownMsg("What the transaction does")?.id).toBe("bg.label.whatTheTransactionDoes");
  });
});
