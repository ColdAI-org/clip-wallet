import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type { Family } from "@clip-wallet/core";
import { SocialProvider } from "../src/social/context";
import type { ContactView, DiscoverFeed, SocialClient } from "../src/social/client";
import { Contacts } from "../src/social/Contacts";
import { ContactEdit } from "../src/social/ContactEdit";
import { HandleScreen } from "../src/social/Handle";
import { NotificationSettingsScreen } from "../src/social/Notifications";
import { Discover, swapRoute } from "../src/social/Discover";
import { socialRoute } from "../src/social/routes";
import { Send } from "../src/screens/Send";
import { TransactionApproval } from "../src/screens/Approval";
import { Settings } from "../src/screens/Settings";
import { useRouter } from "../src/context";
import { fakeClient, payApproval, state } from "./fake-client";
import { renderUi } from "./render";

const ALEX_EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const alex: ContactView = {
  id: "c1",
  name: "Alex",
  initial: "A",
  addresses: [{ family: "evm", address: ALEX_EVM, label: "Main" }],
  createdAt: 1,
  updatedAt: 1,
};

const FEED: DiscoverFeed = {
  trending: [{ id: "cg:layerzero", name: "LayerZero", symbol: "ZRO", priceUsd: 1.82, change24hPct: 4.2, chain: "base", address: "0x6985884C4392D348587B19cb9eAAf157F13271cd", swap: { buy: "token:base:0x6985884C4392D348587B19cb9eAAf157F13271cd", symbol: "ZRO" }, source: "coingecko" }],
  newTokens: [],
  topPools: [
    {
      id: "pool:hedera:x",
      pair: "WHBAR / USDC",
      dex: "saucerswap",
      chain: "hedera",
      liquidityUsd: 4_893_428,
      volume24hUsd: 2_791_142,
      url: "https://dexscreener.com/hedera/x",
      token: { id: "dex:hedera:usdc", name: "USD Coin", symbol: "USDC", chain: "hedera", address: "0x6f89a", swap: { buy: "usdc", symbol: "USDC", assetKey: "usdc" }, source: "dexscreener" },
    },
  ],
  updatedAt: Date.now(),
  unavailable: ["newTokens"],
};

function social(over: Partial<SocialClient> = {}): SocialClient {
  let contacts: ContactView[] = [alex];
  return {
    contacts: vi.fn(async () => ({ contacts, encrypted: true })),
    saveContact: vi.fn(async (p) => {
      const c: ContactView = { id: p.id ?? "c2", name: p.input.name, initial: p.input.name.slice(0, 1).toUpperCase(), addresses: p.input.addresses, createdAt: 2, updatedAt: 2 };
      contacts = [...contacts.filter((x) => x.id !== c.id), c];
      return c;
    }),
    deleteContact: vi.fn(async () => undefined),
    searchContacts: vi.fn(async (p) => (p.query && "alex".startsWith(p.query.toLowerCase()) && (!p.family || p.family === "evm") ? [{ contact: alex, entry: alex.addresses[0]! }] : [])),
    checkAddress: vi.fn(async (p) =>
      p.address.toLowerCase() === ALEX_EVM.toLowerCase()
        ? { contact: { contact: alex, entry: alex.addresses[0]! }, lookalikes: [] }
        : p.address.startsWith("0x9858")
          ? { lookalikes: [{ contact: alex, entry: alex.addresses[0]!, samePrefix: 4, sameSuffix: 4 }] }
          : { lookalikes: [] },
    ),
    detectFamily: vi.fn(async (a: string): Promise<Family[]> => (/^0x[0-9a-fA-F]{40}$/.test(a) ? ["evm", "hedera"] : /^0\.0\.\d+$/.test(a) ? ["hedera"] : [])),
    handleStatus: vi.fn(async () => ({ enabled: false, publishable: [], hederaReady: false })),
    checkHandle: vi.fn(async (h: string) => ({ valid: true, available: h !== "taken" })),
    lookupHandle: vi.fn(async () => null),
    registerHandle: vi.fn(async () => ({ approvalId: "ap-h" })),
    publishHandle: vi.fn(async () => ({ approvalId: "ap-p" })),
    releaseHandle: vi.fn(async () => ({ approvalId: "ap-r" })),
    setHandleReverse: vi.fn(async () => ({ approvalId: "ap-v" })),
    notificationSettings: vi.fn(async () => ({ enabled: false, kinds: { incoming: true, nft: true, confirmed: true, failed: true, price: true, approval: true }, alerts: [] })),
    setNotifications: vi.fn(async (p) => ({ enabled: p.enabled ?? true, kinds: { incoming: true, nft: true, confirmed: true, failed: true, price: true, approval: true, ...p.kinds }, alerts: [] })),
    addPriceAlert: vi.fn(async (p) => ({ id: "al1", symbol: "ETH", createdAt: 1, armed: true, ...p })),
    armPriceAlert: vi.fn(async () => undefined),
    removePriceAlert: vi.fn(async () => undefined),
    testNotification: vi.fn(async () => undefined),
    requestNotificationPermission: vi.fn(async () => true),
    discover: vi.fn(async () => FEED),
    ...over,
  };
}

function Where() {
  return <span data-testid="path">{useRouter().path}</span>;
}

function renderSocial(ui: ReactElement, s = social(), opts: Parameters<typeof renderUi>[1] = {}) {
  const r = renderUi(
    <SocialProvider client={s}>
      {ui}
      <Where />
    </SocialProvider>,
    opts,
  );
  return { ...r, s };
}

describe("Contacts", () => {
  it("lists contacts with avatar initials and filters as you type", async () => {
    renderSocial(<Contacts />, social({ contacts: vi.fn(async () => ({ contacts: [alex, { ...alex, id: "c2", name: "Élodie", initial: "É", addresses: [{ family: "solana" as Family, address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH" }] }], encrypted: true })) }));
    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("É")).toHaveClass("clip-contact-avatar");
    await userEvent.type(screen.getByLabelText("Search contacts"), "elo");
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    expect(screen.getByText("Élodie")).toBeInTheDocument();
  });

  it("empty state explains why contacts help", async () => {
    renderSocial(<Contacts />, social({ contacts: vi.fn(async () => ({ contacts: [], encrypted: false })) }));
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
    expect(screen.getByText(/look-alike addresses/)).toBeInTheDocument();
    expect(screen.getByText(/without extra encryption/)).toBeInTheDocument();
  });

  it("adds a contact: the kind of address is detected, and asked when several fit", async () => {
    const { s } = renderSocial(<ContactEdit />);
    await userEvent.type(screen.getByLabelText("Name"), "Sam");
    const addr = screen.getByLabelText("Address 1");
    await userEvent.type(addr, "0x1234567890AbcdEF1234567890aBcdef12345678");
    await userEvent.tab();
    const kind = await screen.findByLabelText("Kind of address");
    await userEvent.selectOptions(kind, "evm");
    await userEvent.click(screen.getByRole("button", { name: "Save contact" }));
    await waitFor(() => expect(s.saveContact).toHaveBeenCalledWith({ input: { name: "Sam", addresses: [{ family: "evm", address: "0x1234567890AbcdEF1234567890aBcdef12345678" }] } }));
  });

  it("shows background errors in plain words", async () => {
    const s = social({ saveContact: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { userMessage: "0x12…5678 is already saved for Alex.", code: "contacts/address-taken" }))) });
    renderSocial(<ContactEdit prefill={{ address: "0.0.1234" }} />, s);
    await userEvent.type(screen.getByLabelText("Name"), "Sam");
    await screen.findByText("Hedera (HBAR)");
    await userEvent.click(screen.getByRole("button", { name: "Save contact" }));
    expect(await screen.findByText("One of these addresses is already saved for another contact.")).toBeInTheDocument();
  });

  it("routes /contacts, /contacts/new and /contacts/<id>", () => {
    expect(socialRoute(["contacts"], new URLSearchParams())).not.toBeNull();
    expect(socialRoute(["contacts", "new"], new URLSearchParams("address=0x1&family=evm"))).not.toBeNull();
    expect(socialRoute(["contacts", "c1"], new URLSearchParams())).not.toBeNull();
    expect(socialRoute(["settings", "notifications"], new URLSearchParams())).not.toBeNull();
    expect(socialRoute(["settings"], new URLSearchParams())).toBeNull();
  });
});

describe("Send with contacts", () => {
  it("suggests contacts for the asset's family and fills the address", async () => {
    const { client } = renderSocial(<Send assetKey="eth" />);
    const to = await screen.findByLabelText("To");
    expect(to).toHaveAttribute("placeholder", "Name, @handle or address");
    await userEvent.type(to, "al");
    const list = await screen.findByRole("list", { name: "Contacts" });
    await userEvent.click(within(list).getByRole("button", { name: /Alex/ }));
    expect(to).toHaveValue(ALEX_EVM);
    expect(screen.getByText("Alex (from your contacts)")).toBeInTheDocument();
    void client;
  });

  it("in German: the screen is translated and a comma decimal is sent as the canonical amount", async () => {
    const client = fakeClient();
    client.resolveRecipient = vi.fn(async () => ({ kind: "resolved" as const, address: ALEX_EVM, networkId: "eip155:84532" }));
    renderSocial(<Send assetKey="eth" />, social(), { client, state: state({}, { locale: "de" }) });
    // German loads on demand; the screen then reads in German.
    await userEvent.type(await screen.findByLabelText("An"), ALEX_EVM);
    await userEvent.type(screen.getByLabelText("Betrag"), "0,01");
    await userEvent.click(screen.getByRole("button", { name: "Prüfen" }));
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ amount: "0.01" })));
  });
});

describe("Approval recipient check", () => {
  it("says who you're paying when it's a contact", async () => {
    renderSocial(<TransactionApproval approval={payApproval({ recipient: { address: ALEX_EVM.toLowerCase(), family: "evm" } })} />);
    expect(await screen.findByTestId("recipient-contact")).toHaveTextContent("Sending to Alex");
  });

  it("warns about a look-alike of a contact's address (address poisoning)", async () => {
    const poisoned = "0x9858aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaDa94";
    renderSocial(<TransactionApproval approval={payApproval({ recipient: { address: poisoned, family: "evm" } })} />);
    const warn = await screen.findByTestId("recipient-lookalike");
    expect(warn).toHaveTextContent("Look-alike address");
    expect(warn).toHaveTextContent(`This: ${poisoned}`);
    expect(warn).toHaveTextContent(`Saved: ${ALEX_EVM}`);
  });

  it("shows nothing extra for unknown recipients or without the social client", async () => {
    renderUi(<TransactionApproval approval={payApproval({ recipient: { address: ALEX_EVM, family: "evm" } })} />);
    expect(screen.queryByTestId("recipient-contact")).not.toBeInTheDocument();
  });
});

describe("Clip handle", () => {
  it("says plainly when handles aren't switched on", async () => {
    renderSocial(<HandleScreen />);
    expect(await screen.findByText("Clip handles aren't switched on in this version yet.")).toBeInTheDocument();
  });

  it("claims an available handle through the approval queue", async () => {
    const s = social({ handleStatus: vi.fn(async () => ({ enabled: true, publishable: [], hederaReady: true })) });
    renderSocial(<HandleScreen />, s);
    await userEvent.type(await screen.findByLabelText("Pick a handle"), "@Alex");
    expect(await screen.findByText("@alex is available.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Claim @alex" }));
    await waitFor(() => expect(s.registerHandle).toHaveBeenCalledWith("alex"));
    expect(screen.getByTestId("path")).toHaveTextContent("/approval/ap-h");
  });

  it("publishing several addresses needs the privacy warning acknowledged first", async () => {
    const s = social({
      handleStatus: vi.fn(async () => ({
        enabled: true,
        hederaReady: true,
        publishable: [
          { family: "evm" as Family, address: ALEX_EVM },
          { family: "solana" as Family, address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH" },
        ],
        mine: { handle: "alex", records: [], reverse: false, registeredAt: Date.UTC(2026, 0, 2) },
      })),
    });
    renderSocial(<HandleScreen />, s);
    expect(await screen.findByText("You are @alex")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /Ethereum-style/ }));
    await userEvent.click(screen.getByRole("switch", { name: /Solana/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("these 2 addresses belong to the same person (@alex)");
    const publish = screen.getByRole("button", { name: "Publish changes" });
    expect(publish).toBeDisabled();
    await userEvent.click(screen.getByLabelText("I understand these addresses become public and linked"));
    await userEvent.click(publish);
    await waitFor(() => expect(s.publishHandle).toHaveBeenCalledWith([{ family: "evm", address: ALEX_EVM }, { family: "solana", address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH" }]));
  });
});

describe("Notification settings", () => {
  it("turning on asks for permission first, then shows the per-kind switches", async () => {
    const s = social();
    renderSocial(<NotificationSettingsScreen />, s);
    await userEvent.click(await screen.findByRole("switch", { name: /Turn on notifications/ }));
    expect(s.requestNotificationPermission).toHaveBeenCalled();
    await waitFor(() => expect(s.setNotifications).toHaveBeenCalledWith({ enabled: true }));
    await userEvent.click(await screen.findByRole("switch", { name: "New collectibles" }));
    expect(s.setNotifications).toHaveBeenLastCalledWith({ kinds: { nft: false } });
  });

  it("a refused permission keeps them off and says how to fix it", async () => {
    const s = social({ requestNotificationPermission: vi.fn(async () => false) });
    renderSocial(<NotificationSettingsScreen />, s);
    await userEvent.click(await screen.findByRole("switch", { name: /Turn on notifications/ }));
    expect(await screen.findByText(/Notifications are blocked/)).toBeInTheDocument();
    expect(s.setNotifications).not.toHaveBeenCalled();
  });

  it("adds a price alert in the display currency", async () => {
    const s = social();
    renderSocial(<NotificationSettingsScreen />, s);
    await userEvent.type(await screen.findByLabelText("Price (USD)"), "3500");
    await userEvent.click(screen.getByRole("button", { name: "Add alert" }));
    await waitFor(() => expect(s.addPriceAlert).toHaveBeenCalledWith(expect.objectContaining({ direction: "above", price: 3500, currency: "USD" })));
  });
});

describe("Discover", () => {
  it("shows trending and pools, says when a section is unavailable, and every row opens Swap", async () => {
    renderSocial(<Discover />);
    expect(await screen.findByText("ZRO")).toBeInTheDocument();
    expect(screen.getByText("WHBAR / USDC")).toBeInTheDocument();
    expect(screen.getByText("This list couldn't be loaded right now.")).toBeInTheDocument();
    expect(screen.getByText(/\$2\.8M traded today/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Swap for USDC" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/swap?buy=usdc");
  });

  it("unknown tokens carry their symbol to Swap", () => {
    expect(swapRoute(FEED.trending[0]!)).toBe("/swap?buy=token%3Abase%3A0x6985884C4392D348587B19cb9eAAf157F13271cd&buySymbol=ZRO");
  });
});

describe("Settings and language", () => {
  it("shows the social entries and a language picker that saves prefs.locale", async () => {
    const client = fakeClient();
    renderSocial(<Settings />, social(), { client });
    expect(screen.getByRole("navigation", { name: "Contacts and notifications" })).toBeInTheDocument();
    const lang = screen.getByLabelText("Language");
    expect(within(lang).getByRole("option", { name: "Match device (English)" })).toBeInTheDocument();
    expect(within(lang).getByRole("option", { name: "العربية" })).toHaveAttribute("dir", "rtl");
    await userEvent.selectOptions(lang, "de");
    expect(client.setPrefs).toHaveBeenCalledWith({ locale: "de" });
  });

  it("sets the document language and direction from the chosen locale", async () => {
    renderUi(<Settings />, { state: state({}, { locale: "ar" }) });
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("ar");
  });
});
