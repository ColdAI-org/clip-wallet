import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletClient } from "../src/client";
import type { PasskeyFactory } from "../src/context";
import { ClipProvider, Router } from "../src/context";
import { render } from "@testing-library/react";
import { RecoveryPhraseBackup, quizPositions } from "../src/screens/RecoveryPhrase";
import { BackupLinkLanding, PasskeyBackup, PasskeyRestore } from "../src/screens/PasskeyBackup";
import { Accounts } from "../src/screens/Accounts";
import type { AccountView, BackupStatusView, PlatformClient } from "../src/platform/client";
import { asPlatform } from "../src/platform/client";
import { runCeremony } from "../src/platform/ceremony";
import { fakeClient, state } from "./fake-client";
import { renderUi } from "./render";

const WORDS = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima".split(" ");

function platform(over: Partial<PlatformClient> = {}): PlatformClient {
  return {
    backupStatus: vi.fn(async (): Promise<BackupStatusView> => ({ signedIn: false, backups: [], available: true })),
    backupStartSignIn: vi.fn(async () => undefined),
    backupCompleteSignIn: vi.fn(async () => undefined),
    backupSignOut: vi.fn(async () => undefined),
    backupDelete: vi.fn(async () => undefined),
    passkeyBackupBegin: vi.fn(async () => ({ id: "c1", op: "enroll" as const, rpId: "wallet.example", rpName: "Clip", userId: "AA", userName: "Clip", prfInput: "AQID", mode: "web-bridge" as const, bridgeUrl: "" })),
    passkeyRestoreBegin: vi.fn(async () => ({ id: "c2", op: "unlock" as const, rpId: "wallet.example", rpName: "Clip", userId: "AA", userName: "Clip", prfInput: "AQID", credentialId: "BAUG", mode: "web-bridge" as const, bridgeUrl: "" })),
    markPhraseBackedUp: vi.fn(async () => undefined),
    listAccounts: vi.fn(async (): Promise<AccountView[]> => []),
    addAccount: vi.fn(async () => ({ id: "evm:1", family: "evm" as const, index: 1, label: "Account 2", address: "0x2" })),
    renameAccount: vi.fn(async () => undefined),
    getActiveAccounts: vi.fn(async () => ({ defaults: {} })),
    setActiveAccount: vi.fn(async () => undefined),
    ...over,
  };
}

function client(p: Partial<PlatformClient> = {}, w: Partial<WalletClient> = {}) {
  return { ...fakeClient(w), ...platform(p) } as WalletClient & PlatformClient;
}

const fakePasskeys = (canRunHere = true): PasskeyFactory & { calls: string[] } => {
  const calls: string[] = [];
  return {
    canRunHere,
    calls,
    create: () => ({
      enroll: async (input) => {
        calls.push(`enroll:${[...input].join(",")}`);
        return { credentialId: new Uint8Array([9, 9]), prfOutput: new Uint8Array(32).fill(7) };
      },
      evaluate: async (cred, input) => {
        calls.push(`evaluate:${[...cred].join(",")}:${[...input].join(",")}`);
        return new Uint8Array(32).fill(8);
      },
    }),
  };
};

function renderWithPasskeys(ui: React.ReactElement, c: WalletClient, passkeys?: PasskeyFactory) {
  return render(
    <ClipProvider client={c} initialState={state()} {...(passkeys ? { passkeys } : {})}>
      <Router memory initial="/">
        {ui}
      </Router>
    </ClipProvider>,
  );
}

describe("Recovery phrase backup", () => {
  async function toPhrase(c = client()) {
    const user = userEvent.setup();
    renderUi(<RecoveryPhraseBackup quizPositions={[0, 5, 11]} />, { client: c });
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Your wallet password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your recovery phrase" });
    return { user, c };
  }

  it("asks for the password first, and the vault checks it", async () => {
    const { c } = await toPhrase();
    expect(c.revealPhrase).toHaveBeenCalledWith("correct horse");
  });

  it("wrong password shows the vault's message and never reveals", async () => {
    const user = userEvent.setup();
    const c = client({}, { revealPhrase: vi.fn(async () => Promise.reject({ userMessage: "That password isn't right.", code: "vault/bad-password" })) });
    renderUi(<RecoveryPhraseBackup />, { client: c });
    await user.type(screen.getByLabelText("Your wallet password"), "nope");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("That password isn't right.")).toBeInTheDocument();
  });

  it("hidden words are not in the DOM at all; click reveals, click hides", async () => {
    const { user } = await toPhrase();
    const grid = screen.getByTestId("phrase-grid");
    for (const w of WORDS) expect(grid.textContent).not.toContain(w);
    expect(document.body.innerHTML).not.toMatch(/foxtrot|juliet/);
    await user.click(screen.getByRole("button", { name: "Hold or click to show" }));
    expect(grid.textContent).toContain("foxtrot");
    await user.click(screen.getByRole("button", { name: "Hide words" }));
    expect(document.body.innerHTML).not.toMatch(/foxtrot/);
  });

  it("press-and-hold shows only while held", async () => {
    await toPhrase();
    const btn = screen.getByRole("button", { name: "Hold or click to show" });
    fireEvent.pointerDown(btn);
    expect(screen.getByTestId("phrase-grid").textContent).toContain("alpha");
    fireEvent.pointerUp(btn);
    expect(screen.getByTestId("phrase-grid").textContent).not.toContain("alpha");
  });

  it("hides when the window loses focus", async () => {
    const { user } = await toPhrase();
    await user.click(screen.getByRole("button", { name: "Hold or click to show" }));
    expect(screen.getByTestId("phrase-grid").textContent).toContain("alpha");
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(screen.getByTestId("phrase-grid").textContent).not.toContain("alpha");
  });

  it("copy is blocked by default and allowed only after opting in", async () => {
    const { user } = await toPhrase();
    await user.click(screen.getByRole("button", { name: "Hold or click to show" }));
    const grid = screen.getByTestId("phrase-grid");
    const blocked = fireEvent.copy(grid);
    expect(blocked).toBe(false); // default prevented
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Allow copying" }));
    expect(fireEvent.copy(screen.getByTestId("phrase-grid"))).toBe(true);
  });

  it("quiz: wrong words are refused, right words pass and record the backup", async () => {
    const { user, c } = await toPhrase();
    await user.click(screen.getByRole("button", { name: "I've written it down" }));
    await user.type(screen.getByLabelText("Word 1"), "alpha");
    await user.type(screen.getByLabelText("Word 6"), "golf");
    await user.type(screen.getByLabelText("Word 12"), "lima");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/doesn't match/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Word 6"));
    await user.type(screen.getByLabelText("Word 6"), " Foxtrot ");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("heading", { name: "You're backed up" })).toBeInTheDocument();
    expect(c.markPhraseBackedUp).toHaveBeenCalled();
    expect(document.body.innerHTML).not.toMatch(/foxtrot/i);
  });

  it("quizPositions picks distinct sorted positions", () => {
    let i = 0;
    const seq = [0.5, 0.5, 0.1, 0.9];
    expect(quizPositions(12, 3, () => seq[i++]!)).toEqual([1, 6, 10]);
  });
});

describe("Passkey backup", () => {
  it("explains plainly who can restore, before anything else", async () => {
    renderUi(<PasskeyBackup />, { client: client() });
    const ex = await screen.findByTestId("passkey-backup-explainer");
    expect(ex).toHaveTextContent(/Apple, Google or password-manager account/);
    expect(ex).toHaveTextContent(/could restore this wallet/);
    expect(ex).toHaveTextContent(/We store only the locked copy/);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("email sign-in, then password + passkey → backup created", async () => {
    const user = userEvent.setup();
    let signedIn = false;
    const c = client({
      backupStatus: vi.fn(async () => ({ signedIn, backups: signedIn ? [] : [], available: true, ...(signedIn ? { email: "me@example.com" } : {}) })),
      backupCompleteSignIn: vi.fn(async () => {
        signedIn = true;
      }),
    });
    const pk = fakePasskeys();
    renderWithPasskeys(<PasskeyBackup />, c, pk);
    await user.click(await screen.findByLabelText(/I understand who can restore/));
    await user.type(screen.getByLabelText("Email"), "me@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(c.backupStartSignIn).toHaveBeenCalledWith({ email: "me@example.com" });
    expect(await screen.findByText(/Open it on this device/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Link from the email"), "https://wallet.example/backup#/backup/sign-in?token=x");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("Your wallet password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /Create backup passkey/ }));
    await screen.findByText(/Backed up\./);
    expect(c.passkeyBackupBegin).toHaveBeenCalledWith({ password: "correct horse" });
    expect(pk.calls).toEqual(["enroll:1,2,3"]);
    expect(c.passkeyFinish).toHaveBeenCalledWith({ id: "c1", credentialId: "CQk", prfOutput: expect.any(String) });
  });

  it("in the popup, hands the passkey step to a full tab", async () => {
    const user = userEvent.setup();
    const c = client({ backupStatus: vi.fn(async () => ({ signedIn: true, backups: [], available: true })) });
    renderWithPasskeys(<PasskeyBackup />, c, fakePasskeys(false));
    await user.click(await screen.findByLabelText(/I understand/));
    await user.type(screen.getByLabelText("Your wallet password"), "pw-123456");
    await user.click(screen.getByRole("button", { name: /Create backup passkey/ }));
    expect(c.openFullTab).toHaveBeenCalledWith("/backup/passkey");
    expect(c.passkeyBackupBegin).not.toHaveBeenCalled();
  });

  it("lists backups and deletes one", async () => {
    const user = userEvent.setup();
    const c = client({ backupStatus: vi.fn(async () => ({ signedIn: true, email: "me@example.com", backups: [{ id: "b1", createdAt: Date.UTC(2026, 9, 1) }], available: true })) });
    renderUi(<PasskeyBackup />, { client: c });
    expect(await screen.findByText(/Signed in as me@example.com/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(c.backupDelete).toHaveBeenCalledWith({ id: "b1" });
  });

  it("unavailable build says so and points at the phrase", async () => {
    renderUi(<PasskeyBackup />, { client: client({ backupStatus: vi.fn(async () => ({ signedIn: false, backups: [], available: false })) }) });
    expect(await screen.findByText(/isn't available in this version/)).toBeInTheDocument();
  });

  it("restore on a new device: pick a backup, set a password, passkey evaluates the stored credential", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const c = client({ backupStatus: vi.fn(async () => ({ signedIn: true, backups: [{ id: "b1", createdAt: Date.UTC(2026, 9, 1) }], available: true })) });
    const pk = fakePasskeys();
    renderWithPasskeys(<PasskeyRestore onDone={onDone} />, c, pk);
    await user.click(await screen.findByRole("radio", { name: /Backup from/ }));
    await user.type(screen.getByLabelText("New password for this device"), "Tr1cky-Lantern-88");
    await user.type(screen.getByLabelText("Type it again"), "Tr1cky-Lantern-88");
    await user.click(screen.getByRole("button", { name: /Unlock with passkey/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(c.passkeyRestoreBegin).toHaveBeenCalledWith({ backupId: "b1", password: "Tr1cky-Lantern-88" });
    expect(pk.calls).toEqual(["evaluate:4,5,6:1,2,3"]);
  });

  it("the emailed link finishes sign-in when opened in the wallet tab", async () => {
    const c = client();
    renderUi(<BackupLinkLanding link="https://wallet.example/backup#/backup/sign-in?token=abc" />, { client: c });
    expect(await screen.findByRole("heading", { name: "You're signed in" })).toBeInTheDocument();
    expect(c.backupCompleteSignIn).toHaveBeenCalledWith({ link: "https://wallet.example/backup#/backup/sign-in?token=abc" });
  });

  it("runCeremony reports a cancelled passkey back to the background", async () => {
    const finish = vi.fn(async () => undefined);
    const factory = { create: () => ({ enroll: async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })), evaluate: async () => new Uint8Array() }) };
    await expect(runCeremony({ passkeyFinish: finish }, factory, async () => ({ id: "c9", op: "enroll", rpId: null, rpName: "", userId: "", userName: "", prfInput: "AQ", mode: "extension", bridgeUrl: "" }))).rejects.toThrow();
    expect(finish).toHaveBeenCalledWith({ id: "c9", error: "failed" });
  });
});

describe("Accounts", () => {
  const ACCOUNTS: AccountView[] = [
    { id: "evm:0", family: "evm", index: 0, label: "Account 1", address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" },
    { id: "evm:1", family: "evm", index: 1, label: "Savings", address: "0x1234567890AbcdEF1234567890aBcdef12345678" },
    { id: "hedera:0", family: "hedera", index: 0, label: "Account 1", address: "0xabc", displayAddress: "0.0.1001" },
  ];

  it("groups by kind in plain words, marks the one in use, adds per kind", async () => {
    const user = userEvent.setup();
    const c = client({ listAccounts: vi.fn(async () => ACCOUNTS), getActiveAccounts: vi.fn(async () => ({ defaults: { evm: "evm:1" } })) });
    renderUi(<Accounts />, { client: c });
    const evm = await screen.findByRole("list", { name: /Ethereum-style/ });
    expect(within(screen.getByTestId("account-evm:1")).getByText("In use")).toBeInTheDocument();
    expect(within(evm).getByText("0x9858…da94")).toBeInTheDocument();
    expect(screen.getByText("0.0.1001")).toBeInTheDocument();
    expect(screen.queryByText(/Sepolia|eip155/)).not.toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: "Add account" });
    await user.click(addButtons[0]!);
    expect(c.addAccount).toHaveBeenCalledWith({ family: "evm" });
  });

  it("renames an account", async () => {
    const user = userEvent.setup();
    const c = client({ listAccounts: vi.fn(async () => ACCOUNTS) });
    renderUi(<Accounts />, { client: c });
    await user.click(await screen.findByRole("button", { name: "Rename Savings" }));
    const f = screen.getByLabelText("Name for Savings");
    await user.clear(f);
    await user.type(f, "Trading");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(c.renameAccount).toHaveBeenCalledWith({ id: "evm:1", label: "Trading" });
  });

  it("per-app: switch which account a site sees, and reset to default", async () => {
    const user = userEvent.setup();
    const c = client({
      listAccounts: vi.fn(async () => ACCOUNTS),
      getActiveAccounts: vi.fn(async () => ({ defaults: { evm: "evm:0" }, forOrigin: { evm: "evm:0" } })),
    });
    renderUi(<Accounts origin="https://app.uniswap.org" />, { client: c });
    expect(await screen.findByText(/Choose which account app.uniswap.org sees/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Savings" }));
    expect(c.setActiveAccount).toHaveBeenCalledWith({ family: "evm", accountId: "evm:1", origin: "https://app.uniswap.org" });
    await user.click(screen.getByRole("button", { name: "Use my default account here" }));
    expect(c.setActiveAccount).toHaveBeenCalledWith({ family: "evm", accountId: null, origin: "https://app.uniswap.org" });
  });

  it("asPlatform fails loudly when the client isn't wired yet", () => {
    expect(() => asPlatform(fakeClient())).toThrow(/integration\/platform\.md/);
  });
});
