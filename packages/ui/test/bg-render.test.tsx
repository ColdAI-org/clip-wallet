/** The UI renders background text (Msg) in the person's language, with the module's English as the fallback. */
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loadBgMessages, msg, type Warning } from "@clip-wallet/core";
import { formatMsg } from "@clip-wallet/i18n";
import { Warnings } from "../src/components";
import { userMessageOf } from "../src/client";
import { renderUi } from "./render";
import { state } from "./fake-client";

const general: Warning = { level: "caution", code: "memo-required", message: "GABC…XYZ needs a memo (exchanges use it to know whose deposit it is)." };
const specific: Warning = {
  level: "danger",
  code: "unlimited-approval",
  message: "This lets Uniswap take all your USDC, now or any time later, without asking again. Only allow this for apps you trust.",
  msg: msg("bg.warn.letsTakeAll", { spender: "Uniswap", symbol: "USDC" }),
};

describe("background text in the UI", () => {
  it("English shows exactly what the module said", () => {
    renderUi(<Warnings warnings={[general, specific]} />, { state: state({}, { locale: "en" }) });
    expect(screen.getByText(general.message)).toBeInTheDocument();
    expect(screen.getByText(specific.message)).toBeInTheDocument();
  });

  it("German translates; a warning with only its code's general message keeps the English detail underneath", async () => {
    const de = (await loadBgMessages("de")) as Record<string, string>;
    renderUi(<Warnings warnings={[general, specific]} />, { state: state({}, { locale: "de" }) });
    await waitFor(() => expect(screen.getByText(formatMsg(specific.msg!, de, "de"))).toBeInTheDocument());
    expect(screen.getByText(de["bg.warn.memoRequired"]!)).toBeInTheDocument();
    const detail = screen.getByText(general.message);
    expect(detail).toHaveClass("clip-notice__detail");
    expect(detail).toHaveAttribute("lang", "en");
  });

  it("errors from the background are translated by their Msg or their kind", async () => {
    const de = (await loadBgMessages("de")) as Record<string, string>;
    renderUi(<Warnings warnings={[]} />, { state: state({}, { locale: "de" }) });
    await waitFor(() => expect(userMessageOf({ userMessage: "That's your own address.", code: "near/self-transfer" })).toBe(de["bg.err.ownAddress"]));
    expect(userMessageOf({ userMessage: "You don't have enough NEAR for this.", code: "near/insufficient-funds" })).toBe(de["bg.err.cat.insufficient"]);
    expect(userMessageOf({ userMessage: "Unlisted.", code: "x/odd" })).toBe("Unlisted.");
  });
});
