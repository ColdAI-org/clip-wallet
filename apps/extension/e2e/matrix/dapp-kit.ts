/**
 * The tiny contract between a matrix dapp page and matrix.spec.ts: the page sets `window.__matrix` with which dapp
 * library it is, and steps the spec runs (connect → { address }, sign → { valid, how }, send → { id }).
 */
declare global {
  /** Set from WALLETCONNECT_PROJECT_ID at bundle time ("" when unset). */
  const __MATRIX_WC_PROJECT_ID__: string;
  /** Public keys of the matrix accounts (addresses.json), for ecosystems whose verify function takes the key. */
  const __MATRIX_PUBKEYS__: Record<string, string>;
}

export interface MatrixDapp {
  info: { dapp: string; why: string };
  steps: {
    connect(): Promise<{ address: string } & Record<string, unknown>>;
    sign?(): Promise<{ valid: boolean; how: string } & Record<string, unknown>>;
    send(arg: { amount: "min" }): Promise<{ id: string } & Record<string, unknown>>;
  } & Record<string, (arg?: never) => Promise<unknown>>;
}

export function expose(d: MatrixDapp) {
  (window as unknown as { __matrix: unknown }).__matrix = {
    info: d.info,
    run: (step: string, arg?: unknown) => {
      const f = (d.steps as Record<string, (a?: unknown) => Promise<unknown>>)[step];
      if (!f) throw new Error(`no step ${step}`);
      return f(arg);
    },
  };
}

export const waitFor = async <T>(f: () => T | undefined | null, what: string, ms = 5000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what} not found`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));
export const MESSAGE = "Clip Wallet dapp matrix: sign-in check (testnet)";

/** Thrown by a dapp that can't even build the request without funds (no UTXOs, no account yet). */
export class NeedsFunds extends Error {
  override name = "NeedsFunds";
}
