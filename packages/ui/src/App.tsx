import { useEffect, useState, type ReactNode } from "react";
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
import { ApprovalQueue } from "./screens/Approvals";
import { PasskeyPage } from "./screens/Passkey";

export function parsePath(path: string): { pathname: string; query: URLSearchParams } {
  const [p, q] = path.split("?");
  return { pathname: p || "/", query: new URLSearchParams(q ?? "") };
}

function Routes() {
  const { state, refresh } = useUi();
  const { path, navigate } = useRouter();
  const { pathname, query } = parsePath(path);
  // Once onboarding starts it stays on screen until it finishes: the vault turns "unlocked" as soon as
  // the wallet is created, but the phrase, backup check and passkey offer still follow.
  const [onboarding, setOnboarding] = useState(false);
  useEffect(() => {
    if (state?.status === "empty") setOnboarding(true);
  }, [state?.status]);

  if (!state) return <div className="clip-screen clip-center"><Spinner /></div>;
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
      return <Settings />;
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
          <Routes />
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
          <ApprovalWindowRoutes focusId={props.focusId} onEmpty={props.onEmpty} />
        </Frame>
      </Router>
    </ClipProvider>
  );
}
