import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import { build } from "esbuild";
import { createConfig, http, connect as wagmiConnect } from "@wagmi/core";
import { baseSepolia } from "@wagmi/core/chains";
import { afterEach, describe, expect, it } from "vitest";
import { ClipConnectProvider, useClipConnect } from "../src/react.js";
import { clipConnect } from "../src/wagmi.js";
import { clipSolanaAdapter, isSolanaWallet } from "../src/solana.js";
import { resetDiscovery } from "../src/discovery.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ME = "0x1111111111111111111111111111111111111111";

function clipProvider() {
  return {
    async request({ method }: { method: string }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ME];
      if (method === "eth_chainId") return "0x14a34";
      throw Object.assign(new Error("unsupported"), { code: 4200 });
    },
    on() {},
    removeListener() {},
  };
}

function announceClip(provider: unknown) {
  const detail = Object.freeze({ info: { uuid: "u-clip", name: "Clip Wallet", icon: "data:image/svg+xml,", rdns: "org.coldai.clipwallet" }, provider });
  window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })));
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
}

afterEach(() => resetDiscovery());

describe("React", () => {
  it("useClipConnect connects through the provider and exposes the connection", async () => {
    announceClip(clipProvider());
    function App() {
      const { connection, status, connect } = useClipConnect();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="account">{connection?.accounts[0] ?? ""}</span>
          <button onClick={() => void connect()}>connect</button>
        </div>
      );
    }
    render(
      <ClipConnectProvider options={{ waitMs: 0 }}>
        <App />
      </ClipConnectProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("idle");
    await act(async () => screen.getByText("connect").click());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("account").textContent).toBe(`eip155:84532:${ME}`);
  });

  it("the hook outside its provider says what's missing", () => {
    function Bad() {
      useClipConnect();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/ClipConnectProvider/);
  });
});

describe("wagmi connector", () => {
  it("targets Clip Wallet's EIP-6963 provider and connects through wagmi", async () => {
    announceClip(clipProvider());
    const config = createConfig({ chains: [baseSepolia], transports: { [baseSepolia.id]: http() }, connectors: [clipConnect()], multiInjectedProviderDiscovery: false });
    const connector = config.connectors[0]!;
    expect(connector.id).toBe("clipConnect");
    const r = await wagmiConnect(config, { connector });
    expect(r.accounts).toEqual([ME]);
    expect(r.chainId).toBe(84532);
  });
});

describe("Solana wallet-adapter wrapper", () => {
  it("wraps Clip Wallet's Wallet Standard wallet in a StandardWalletAdapter; null when there is none", () => {
    expect(clipSolanaAdapter()).toBeNull();
    const feature = (name: string) => ({ version: "1.0.0", [name]: async () => ({}) });
    const sol = {
      name: "Clip Wallet",
      icon: "data:image/svg+xml,",
      version: "1.0.0",
      chains: ["solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": feature("connect"),
        "standard:events": { version: "1.0.0", on: () => () => undefined },
        "solana:signTransaction": { ...feature("signTransaction"), supportedTransactionVersions: ["legacy", 0] },
        "solana:signAndSendTransaction": { ...feature("signAndSendTransaction"), supportedTransactionVersions: ["legacy", 0] },
      },
    };
    expect(isSolanaWallet(sol)).toBe(true);
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: ({ register }: { register(w: unknown): void }) => register(sol) }));
    const adapter = clipSolanaAdapter();
    expect(adapter?.name).toBe("Clip Wallet");
  });
});

describe("package hygiene", () => {
  it("depends on no wallet internals: no @clip-wallet/* dependency, no import of them in src", () => {
    const pkg = JSON.parse(readFileSync(path.join(here, "../package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
    expect(Object.keys(deps).filter((d) => d.startsWith("@clip-wallet/"))).toEqual([]);
    for (const f of ["index.ts", "connect.ts", "discovery.ts", "assets.ts", "caip.ts", "react.tsx", "wagmi.ts", "solana.ts"]) {
      expect(readFileSync(path.join(here, "../src", f), "utf8"), f).not.toMatch(/from "@clip-wallet\//);
    }
  });

  it("the core entry stays small (minified + gzip, everything bundled)", async () => {
    const out = await build({ entryPoints: [path.join(here, "../src/index.ts")], bundle: true, minify: true, format: "esm", write: false, platform: "browser" });
    const bytes = out.outputFiles[0]!.contents;
    const { gzipSync } = await import("node:zlib");
    const gz = gzipSync(bytes).length;
    expect(gz).toBeLessThan(6 * 1024);
  });
});
