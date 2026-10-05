import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WalletClient } from "./client";
import type { ClipConfig, UiOptions } from "./theme/config";
import { ClipProvider, Router, useRouter, useUi, type PasskeyFactory, type Variant } from "./context";
import { Spinner } from "./components";
import { Onboarding, Unlock } from "./screens/Onboarding";
import { AssetDetail, Home } from "./screens/Home";
import { CollectibleDetail, Collectibles } from "./screens/Collectibles";
import { Activity } from "./screens/Activity";
import { Send } from "./screens/Send";
import { Receive } from "./screens/Receive";
import { ScanWalletConnect, Settings } from "./screens/Settings";
import { DataUse } from "./screens/DataUse";
import { ApprovalQueue } from "./screens/Approvals";
import { PasskeyPage } from "./screens/Passkey";
import { RecoveryPhraseBackup } from "./screens/RecoveryPhrase";
import { BackupLinkLanding, PasskeyBackup, PasskeyRestore } from "./screens/PasskeyBackup";
import { Accounts } from "./screens/Accounts";
import { BackupHub } from "./screens/Backup";
import { ConnectHardware, HardwareProvider, HardwareSettings, useHardwareOptional, type FullHardwareClient } from "./hardware";
import { FeaturesProvider, featureRoute, useFeaturesOptional, type FeaturesClient } from "./features";
import { PluginSettings } from "./plugins";
import { SocialProvider, socialRoute, useSocialOptional, type SocialClient } from "./social";
import { SecurityProvider, securityRoute, useSecurityOptional, type SecurityClient } from "./security";
import { LinkProvider, ReceiveWallet, linkRoute, useLinkOptional, type LinkClient } from "./link";

export function parsePath(path: string): { pathname: string; query: URLSearchParams } {
  const [p, q] = path.split("?");
  return { pathname: p || "/", query: new URLSearchParams(q ?? "") };
}

/** The action popup can't show the WebHID chooser or the camera prompt: continue in a full tab. */
function OpenInTab(props: { route: string }) {
  const { client } = useUi();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void client.openFullTab(props.route).then(() => window.close());
  }, [client, props.route]);
  return (
    <div className="clip-screen clip-center">
      <Spinner />
    </div>
  );
}

function Routes() {
  const { state, refresh, variant } = useUi();
  const { path, navigate } = useRouter();
  const features = useFeaturesOptional();
  const social = useSocialOptional();
  const security = useSecurityOptional();
  const hardware = useHardwareOptional();
  const link = useLinkOptional();
  const { pathname, query } = parsePath(path);
  // Once onboarding starts it stays on screen until it finishes: the vault turns "unlocked" as soon as
  // the wallet is created, but the phrase, backup check and passkey offer still follow.
  const [onboarding, setOnboarding] = useState(false);
  useEffect(() => {
    if (state?.status === "empty") setOnboarding(true);
  }, [state?.status]);

  if (!state) return <div className="clip-screen clip-center"><Spinner /></div>;
  // Restore on a new device runs while the vault is empty; the emailed sign-in link can land empty or locked.
  if (pathname === "/restore/passkey" && (state.status === "empty" || onboarding)) {
    return (
      <PasskeyRestore
        onDone={async () => {
          setOnboarding(false);
          await refresh();
          navigate("/", { replace: true });
        }}
      />
    );
  }
  // Copying a wallet from another device runs while this one is still empty.
  if (link && pathname === "/link/receive" && (state.status === "empty" || onboarding)) {
    return (
      <ReceiveWallet
        onDone={async () => {
          setOnboarding(false);
          await refresh();
          navigate("/", { replace: true });
        }}
      />
    );
  }
  if (pathname === "/backup/sign-in") return <BackupLinkLanding link={typeof location !== "undefined" ? location.href : path} />;
  if (state.status === "empty" || onboarding) {
    return (
      <div className="clip-screen">
        <Onboarding
          onFinished={async () => {
            setOnboarding(false);
            await refresh();
            navigate("/", { replace: true });
          }}
        />
      </div>
    );
  }
  if (state.status === "locked") {
    if (pathname === "/passkey/unlock") return <PasskeyPage mode="unlock" onDone={() => void refresh()} />;
    return (
      <div className="clip-screen">
        <Unlock onUnlocked={() => void refresh()} />
      </div>
    );
  }

  const seg = pathname.split("/").filter(Boolean);
  if (social) {
    const screen = socialRoute(seg, query);
    if (screen) return screen;
  }
  if (features) {
    const feature = featureRoute(seg, query, typeof location !== "undefined" ? location.hash : "");
    if (feature) return feature;
  }
  switch (seg[0]) {
    case undefined:
      return <Home />;
    case "asset":
      return <AssetDetail id={decodeURIComponent(seg[1] ?? "")} />;
    case "collectibles":
      return <Collectibles />;
    case "collectible":
      return <CollectibleDetail id={decodeURIComponent(seg[1] ?? "")} />;
    case "activity":
      return <Activity />;
    case "settings":
      if (seg[1] === "hardware" && hardware) return <HardwareSettings hardware={hardware} onAdd={() => navigate("/hardware/connect")} />;
      if (seg[1] === "plugins") return <PluginSettings />;
      if (seg[1] === "privacy") return <DataUse />;
      if (seg[1] === "security" && security) return securityRoute(seg) ?? <Settings />;
      if (seg[1] === "devices" && link) return linkRoute(seg) ?? <Settings />;
      return <Settings />;
    case "hardware":
      if (!hardware || seg[1] !== "connect") return <Home />;
      return variant === "popup" ? (
        <OpenInTab route="/hardware/connect" />
      ) : (
        <ConnectHardware hardware={hardware} advanced={state.prefs.advanced} onBack={() => navigate("/settings/hardware")} onDone={() => navigate("/", { replace: true })} />
      );
    case "send":
      return <Send assetKey={query.get("asset") ?? undefined} />;
    case "receive":
      return <Receive assetKey={query.get("asset") ?? undefined} />;
    case "approvals":
      return <ApprovalQueue />;
    case "approval":
      return <ApprovalQueue focusId={decodeURIComponent(seg[1] ?? "")} onEmpty={() => navigate("/activity", { replace: true })} />;
    case "scan":
      return <ScanWalletConnect />;
    case "passkey":
      return <PasskeyPage mode={seg[1] === "unlock" ? "unlock" : "enroll"} onDone={() => navigate("/settings", { replace: true })} />;
    case "backup":
      if (seg[1] === "phrase") return <RecoveryPhraseBackup onDone={() => navigate("/backup", { replace: true })} />;
      if (seg[1] === "passkey") return <PasskeyBackup />;
      return <BackupHub />;
    case "accounts":
      return <Accounts {...(query.get("origin") ? { origin: query.get("origin")! } : {})} />;
    default:
      return <Home />;
  }
}

export interface WalletAppProps {
  client: WalletClient;
  config?: ClipConfig;
  options?: Partial<UiOptions>;
  variant?: Variant;
  passkeys?: PasskeyFactory;
  initialRoute?: string;
  memoryRouter?: boolean;
  /** Staking, swaps, buy, Secure Trade and Explore. Without it those screens and menu entries are hidden. */
  features?: FeaturesClient;
  /** Ledger and Keystone. Without it the hardware entry points are hidden. */
  hardware?: FullHardwareClient;
  /** Contacts, Clip handles, notifications and Discover. Without it those screens and entries are hidden. */
  social?: SocialClient;
  /** Settings → Security (permissions, spam cleanup, scam protection). Without it the entry is hidden. */
  security?: SecurityClient;
  /** Settings → Linked devices (phone / desktop signer, sync, moving a wallet). Without it the entry is hidden. */
  link?: LinkClient;
}

function WithLink(props: { link?: LinkClient; children: ReactNode }) {
  return props.link ? <LinkProvider client={props.link}>{props.children}</LinkProvider> : <>{props.children}</>;
}

function WithSocial(props: { social?: SocialClient; children: ReactNode }) {
  return props.social ? <SocialProvider client={props.social}>{props.children}</SocialProvider> : <>{props.children}</>;
}

function WithSecurity(props: { security?: SecurityClient; children: ReactNode }) {
  return props.security ? <SecurityProvider client={props.security}>{props.children}</SecurityProvider> : <>{props.children}</>;
}

function WithHardware(props: { hardware?: FullHardwareClient; children: ReactNode }) {
  return props.hardware ? <HardwareProvider client={props.hardware}>{props.children}</HardwareProvider> : <>{props.children}</>;
}

function Frame(props: { children: ReactNode }) {
  const { variant } = useUi();
  return <div className={`clip-app clip-app--${variant}`}>{props.children}</div>;
}

/** The popup and full-tab wallet. */
export function WalletApp(props: WalletAppProps) {
  return (
    <ClipProvider client={props.client} config={props.config} options={props.options} variant={props.variant} passkeys={props.passkeys}>
      <Router initial={props.initialRoute} memory={props.memoryRouter}>
        <Frame>
          <WithHardware hardware={props.hardware}>
            <WithSocial social={props.social}>
              <WithSecurity security={props.security}>
               <WithLink link={props.link}>
                {props.features ? (
                  <FeaturesProvider client={props.features}>
                    <Routes />
                  </FeaturesProvider>
                ) : (
                  <Routes />
                )}
               </WithLink>
              </WithSecurity>
            </WithSocial>
          </WithHardware>
        </Frame>
      </Router>
    </ClipProvider>
  );
}

function ApprovalWindowRoutes(props: { focusId?: string; onEmpty: () => void }) {
  const { state, refresh } = useUi();
  if (!state) return <div className="clip-screen clip-center"><Spinner /></div>;
  if (state.status !== "unlocked") {
    return (
      <div className="clip-screen">
        <Unlock onUnlocked={() => void refresh()} />
      </div>
    );
  }
  return <ApprovalQueue standalone focusId={props.focusId} onEmpty={props.onEmpty} />;
}

/** The popup window the background opens when an app asks for something. */
export function ApprovalWindowApp(props: Omit<WalletAppProps, "variant" | "initialRoute"> & { focusId?: string; onEmpty: () => void }) {
  return (
    <ClipProvider client={props.client} config={props.config} options={props.options} variant="window" passkeys={props.passkeys}>
      <Router memory initial="/">
        <Frame>
          <WithHardware hardware={props.hardware}>
            <WithSocial social={props.social}>
              <ApprovalWindowRoutes focusId={props.focusId} onEmpty={props.onEmpty} />
            </WithSocial>
          </WithHardware>
        </Frame>
      </Router>
    </ClipProvider>
  );
}
