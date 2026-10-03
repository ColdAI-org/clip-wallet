/** Backup (recovery phrase reveal rules, passkey backup gating) and Accounts (add, rename, per-site). */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AppState } from "react-native";
import { BackupHub, PasskeyBackup, RecoveryPhraseBackup } from "../src/screens/Backup";
import { Accounts } from "../src/screens/Accounts";
import { eventually, renderWith, settle, testWallet, WORDS } from "./helpers";

const PW = "a long test password 42!";

async function ready() {
  const wallet = testWallet();
  await wallet.client.createWallet(PW);
  return wallet;
}

const words = () => WORDS.map((_, i) => screen.getByTestId(`phrase-word-${i}`).props.children as string);

describe("Backup", () => {
  it("the hub offers the phrase and says plainly when passkey backup isn't in this build", async () => {
    const wallet = await ready();
    renderWith(wallet, <BackupHub />, { name: "backup" });
    expect(await eventually(() => screen.getByTestId("passkey-backup-unavailable"))).toBeTruthy();
    expect(screen.getByTestId("backup-phrase")).toBeTruthy();
  });

  it("recovery phrase: password (and biometrics) first, hidden until held or tapped, hides in the background, then the quiz", async () => {
    const wallet = await ready();
    const presence = jest.spyOn(wallet, "confirmPresence");
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (s: string) => void) => (listeners.push(cb), { remove() {} })) as never);
    renderWith(wallet, <RecoveryPhraseBackup quizPositions={[1, 5, 9]} />, { name: "backup-phrase" });
    await settle();

    fireEvent.changeText(screen.getByTestId("phrase-password"), "wrong");
    await act(async () => fireEvent.press(screen.getByTestId("phrase-unlock")));
    await settle();
    expect(screen.getByText("That password isn't right.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("phrase-password"), PW);
    await act(async () => fireEvent.press(screen.getByTestId("phrase-unlock")));
    await settle();
    expect(presence).toHaveBeenCalled();

    // Hidden: placeholders only, the words aren't rendered.
    expect(words().every((w) => w === "••••••")).toBe(true);
    expect(screen.queryByText(WORDS[0]!)).toBeNull();

    // Held: shown while pressed, hidden on release.
    fireEvent(screen.getByTestId("phrase-reveal"), "pressIn");
    expect(words()).toEqual(WORDS);
    fireEvent(screen.getByTestId("phrase-reveal"), "pressOut");
    expect(words()[0]).toBe("••••••");

    // Tapped: stays shown, not selectable (copying off) until allowed.
    fireEvent(screen.getByTestId("phrase-reveal"), "pressIn");
    fireEvent(screen.getByTestId("phrase-reveal"), "pressOut");
    fireEvent.press(screen.getByTestId("phrase-reveal"));
    expect(words()).toEqual(WORDS);
    expect(screen.getByTestId("phrase-word-0").props.selectable).toBe(false);
    fireEvent(screen.getByTestId("phrase-allow-copy"), "valueChange", true);
    expect(screen.getByTestId("phrase-word-0").props.selectable).toBe(true);

    // Leaving the app hides it.
    act(() => listeners.forEach((l) => l("background")));
    expect(words()[0]).toBe("••••••");

    fireEvent.press(screen.getByTestId("phrase-written"));
    fireEvent.changeText(screen.getByTestId("quiz-0"), WORDS[1]!);
    fireEvent.changeText(screen.getByTestId("quiz-1"), "nope");
    fireEvent.changeText(screen.getByTestId("quiz-2"), WORDS[9]!);
    fireEvent.press(screen.getByTestId("quiz-check"));
    expect(screen.getByText("That doesn't match. Check what you wrote down, or look at the phrase again.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("quiz-1"), WORDS[5]!);
    await act(async () => fireEvent.press(screen.getByTestId("quiz-check")));
    expect(screen.getByText("You're backed up")).toBeTruthy();
    expect((await wallet.engine.handle({ type: "getState" })).status).toBe("unlocked");
  });

  it("the phrase hides itself after 60 seconds", async () => {
    const wallet = await ready();
    renderWith(wallet, <RecoveryPhraseBackup />, { name: "backup-phrase" });
    await settle();
    fireEvent.changeText(screen.getByTestId("phrase-password"), PW);
    await act(async () => fireEvent.press(screen.getByTestId("phrase-unlock")));
    await settle();
    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByTestId("phrase-reveal"));
      expect(words()).toEqual(WORDS);
      act(() => void jest.advanceTimersByTime(59_000));
      expect(words()).toEqual(WORDS);
      act(() => void jest.advanceTimersByTime(1_000));
      expect(words()[0]).toBe("••••••");
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancelling Face ID keeps the phrase hidden", async () => {
    const wallet = await ready();
    wallet.confirmPresence = async () => {
      throw Object.assign(new Error("cancel"), { userMessage: "Cancelled. Nothing was shown.", code: "presence/cancelled" });
    };
    renderWith(wallet, <RecoveryPhraseBackup />, { name: "backup-phrase" });
    await settle();
    fireEvent.changeText(screen.getByTestId("phrase-password"), PW);
    await act(async () => fireEvent.press(screen.getByTestId("phrase-unlock")));
    await settle();
    expect(screen.getByText("Cancelled. Nothing was shown.")).toBeTruthy();
    expect(screen.queryByTestId("phrase-grid")).toBeNull();
  });

  it("passkey backup: shown only when the build has a backup service", async () => {
    const wallet = await ready();
    renderWith(wallet, <PasskeyBackup />, { name: "backup-passkey" });
    expect(await eventually(() => screen.getByText("Passkey backup isn't available in this version"))).toBeTruthy();
  });

  it("passkey backup with a service: explainer, email sign-in, then the passkey ceremony", async () => {
    const wallet = await ready();
    const calls: string[] = [];
    // The platform service with a backup client is covered in packages/engine; here the status drives the screen.
    const status = { signedIn: false, backups: [] as { id: string; createdAt: number }[], available: true } as Record<string, unknown>;
    const real = wallet.engine.handleUntrusted.bind(wallet.engine);
    wallet.engine.handleUntrusted = async (m: unknown) => {
      const t = (m as { type: string }).type;
      calls.push(t);
      if (t === "backupStatus") return status;
      if (t === "backupStartSignIn") return (status.pendingEmail = (m as { email: string }).email), undefined;
      if (t === "backupCompleteSignIn") return void Object.assign(status, { signedIn: true, email: status.pendingEmail });
      return real(m);
    };
    renderWith(wallet, <PasskeyBackup />, { name: "backup-passkey" });
    expect(await eventually(() => screen.getByTestId("passkey-backup-explainer"))).toBeTruthy();
    expect(screen.getByText(/Passkeys aren't set up in this build/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("backup-understood"));
    fireEvent.changeText(screen.getByTestId("backup-email"), "me@example.com");
    await act(async () => fireEvent.press(screen.getByTestId("backup-email-send")));
    fireEvent.changeText(screen.getByTestId("backup-link"), "https://backup.example/sign-in?token=abc");
    await act(async () => fireEvent.press(screen.getByTestId("backup-link-continue")));
    await settle();
    fireEvent.changeText(await eventually(() => screen.getByTestId("backup-password")), PW);
    await act(async () => fireEvent.press(screen.getByTestId("backup-create")));
    // No passkey domain in this build: it says so instead of starting a ceremony.
    expect(screen.getByText("Passkeys aren't set up in this build. Your recovery phrase is still your backup.")).toBeTruthy();
    expect(calls).toEqual(expect.arrayContaining(["backupStartSignIn", "backupCompleteSignIn"]));
    expect(calls).not.toContain("passkeyBackupBegin");
  });
});

describe("Accounts", () => {
  it("adds, renames and switches the account in use", async () => {
    const wallet = await ready();
    renderWith(wallet, <Accounts />, { name: "accounts" });
    const add = await eventually(() => screen.getByTestId("add-evm"));
    await act(async () => fireEvent.press(add));
    const use = await eventually(() => screen.getByTestId("use-evm:1"));
    await act(async () => fireEvent.press(use));
    await settle();
    expect((await wallet.client.getActiveAccounts()).defaults.evm).toBe("evm:1");
    const label = jest.spyOn(wallet.vault, "setAccountLabel");
    fireEvent.press(screen.getByLabelText("Rename Account 2"));
    fireEvent.changeText(screen.getByTestId("rename-evm:1"), "Savings");
    await act(async () => fireEvent.press(screen.getByTestId("save-evm:1")));
    await settle();
    expect(label).toHaveBeenCalledWith("evm", 1, "Savings");
    expect(screen.queryByTestId("rename-evm:1")).toBeNull();
  });

  it("per site: choose which account one app sees", async () => {
    const wallet = await ready();
    await wallet.client.addAccount({ family: "evm" });
    renderWith(wallet, <Accounts origin="https://dapp.test" />, { name: "accounts", origin: "https://dapp.test" });
    expect(await eventually(() => screen.getByText("Choose which account dapp.test sees. Other apps keep their own choice."))).toBeTruthy();
    expect(screen.queryByTestId("add-evm")).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("use-evm:1")));
    await settle();
    expect((await wallet.client.getActiveAccounts({ origin: "https://dapp.test" })).forOrigin?.evm).toBe("evm:1");
    expect((await wallet.client.getActiveAccounts()).defaults.evm ?? "evm:0").toBe("evm:0");
  });
});
