import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletApp } from "../src/App";
import { DataUse } from "../src/screens/DataUse";
import { PRIVACY_CATALOGS, PRIVACY_SECTIONS } from "../src/i18n/privacy";
import { en } from "../src/i18n/en";
import { fakeClient } from "./fake-client";
import { renderUi } from "./render";

describe("Settings → Your data", () => {
  it("shows every disclosure section in plain words, with the wallet's name", () => {
    renderUi(<DataUse />);
    expect(screen.getByRole("heading", { name: "Your data" })).toBeInTheDocument();
    for (const s of PRIVACY_SECTIONS) expect(screen.getByRole("heading", { name: en[`privacy.${s}.title`] })).toBeInTheDocument();
    expect(screen.getByText(/has no account for you/)).toHaveTextContent(/^Clip Wallet has no account/);
    expect(screen.getByText(/CoinGecko and DEX Screener/)).toBeInTheDocument();
  });

  it("opens from Settings", async () => {
    const c = fakeClient();
    renderUi(<WalletApp client={c} memoryRouter initialRoute="/settings" />, { client: c });
    await userEvent.click(await screen.findByRole("button", { name: "Your data" }));
    expect(await screen.findByTestId("data-use")).toBeInTheDocument();
  });

  it("the mobile catalog carries every language and exactly the English ids", () => {
    const ids = Object.keys(PRIVACY_CATALOGS.en).sort();
    expect(ids).toEqual(Object.keys(en).filter((k) => k.startsWith("privacy.")).sort());
    for (const [code, cat] of Object.entries(PRIVACY_CATALOGS)) expect(Object.keys(cat as object).sort(), code).toEqual(ids);
  });
});
