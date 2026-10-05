import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ApprovalView } from "@clip-wallet/ui";
import type { MobileWallet } from "./background/host";
import { WalletProvider, useWallet, type Route } from "./ui/context";
import { Onboarding, Unlock } from "./screens/Onboarding";
import { AssetDetail, Home } from "./screens/Home";
import { Collectibles } from "./screens/Collectibles";
import { Activity } from "./screens/Activity";
import { Send } from "./screens/Send";
import { Receive } from "./screens/Receive";
import { Settings } from "./screens/Settings";
import { Scan } from "./screens/Scan";
import { Browser } from "./screens/Browser";
import { Explore } from "./screens/Explore";
import { ApprovalScreen } from "./screens/Approval";
import { Stake } from "./screens/Stake";
import { Swap } from "./screens/Swap";
import { Buy } from "./screens/Buy";
import { TradeCreate, TradeDetail, TradeHome, TradeReview } from "./screens/Trade";
import { BackupHub, PasskeyBackup, RecoveryPhraseBackup } from "./screens/Backup";
import { Accounts } from "./screens/Accounts";
import { ConnectHardware, HardwareSettings, HardwareStep } from "./screens/Hardware";
import { Contacts } from "./screens/Contacts";
import { ContactEdit } from "./screens/ContactEdit";
import { Notifications } from "./screens/Notifications";
import { DataUse } from "./screens/DataUse";
import { useNotificationBridge } from "./ui/notifications";
import { parseDeepLink, type DeepLink } from "./lib/deeplinks";
import { APP } from "./env";

function Routes(props: { route: Route }) {
  const r = props.route;
  switch (r.name) {
    case "home":
      return <Home />;
    case "collectibles":
      return <Collectibles />;
    case "activity":
      return <Activity />;
    case "browser":
      return <Browser url={r.url} />;
    case "settings":
      return <Settings />;
    case "asset":
      return <AssetDetail id={r.id} />;
    case "send":
      return <Send assetKey={r.assetKey} />;
    case "receive":
      return <Receive assetKey={r.assetKey} />;
    case "scan":
      return <Scan />;
    case "explore":
      return <Explore />;
    case "stake":
      return <Stake key={r.assetKey ?? ""} assetKey={r.assetKey} />;
    case "swap":
      return <Swap sell={r.sell} buy={r.buy} />;
    case "buy":
      return <Buy assetKey={r.assetKey} />;
    case "trade":
      return <TradeHome />;
    case "trade-new":
      return <TradeCreate />;
    case "trade-open":
      return <TradeReview key={r.link ?? ""} link={r.link} />;
    case "trade-detail":
      return <TradeDetail id={r.id} />;
    case "backup":
      return <BackupHub />;
    case "backup-phrase":
      return <RecoveryPhraseBackup />;
    case "backup-passkey":
      return <PasskeyBackup />;
    case "accounts":
      return <Accounts origin={r.origin} />;
    case "hardware":
      return <HardwareSettings />;
    case "hardware-connect":
      return <ConnectHardware />;
    case "contacts":
      return <Contacts />;
    case "contact":
      return <ContactEdit key={r.id ?? "new"} id={r.id} address={r.address} family={r.family} />;
    case "notifications":
      return <Notifications />;
    case "data-use":
      return <DataUse />;
  }
}

function ApprovalSheet() {
  const { approvalId, showApproval, client, state, wallet } = useWallet();
  const [view, setView] = useState<ApprovalView | null>(null);
  const [n, setN] = useState(0);
  // Re-fetch on every change: a hardware wallet's step (Ledger confirm, Keystone QR exchange) arrives that way.
  useEffect(() => wallet.events.on((e) => e.type === "change" && setN((x) => x + 1)), [wallet]);
  useEffect(() => {
    let live = true;
    if (!approvalId) setView(null);
    else void client.getApproval(approvalId).then((v) => live && (v ? setView(v) : showApproval(null)), () => undefined);
    return () => {
      live = false;
    };
  }, [approvalId, client, showApproval, state?.pendingApprovals, n]);
  const done = async () => {
    // Show the next waiting request, if any.
    const [next] = await client.listApprovals();
    showApproval(next?.id ?? null);
  };
  return (
    <Modal visible={!!approvalId && !!view && state?.status === "unlocked"} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => view && void client.reject(view.id).then(done)}>
      {view && <ApprovalScreen key={view.id} approval={view} onDone={done} />}
      {view?.hardware && <HardwareStep approvalId={view.id} title={view.decoded?.title ?? view.dapp.name} state={view.hardware} />}
    </Modal>
  );
}

function Shell(props: { pendingLink: DeepLink; clearLink: () => void }) {
  const { state, refresh, route, navigate, client, theme } = useWallet();
  useNotificationBridge(!!state && state.status !== "empty");
  useEffect(() => {
    if (state?.status !== "unlocked" || !props.pendingLink) return;
    const l = props.pendingLink;
    props.clearLink();
    if (l.kind === "browse") navigate({ name: "browser", url: l.url });
    else if (l.kind === "trade") navigate({ name: "trade-open", link: l.link });
    else void client.pairWalletConnect(l.uri).catch(() => navigate({ name: "settings" }));
  }, [state?.status, props.pendingLink]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.c.bg }}>
        <ActivityIndicator color={theme.c.accent} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
      {state.status === "empty" ? (
        <Onboarding onFinished={() => (navigate({ name: "home" }), void refresh())} />
      ) : state.status === "locked" ? (
        <Unlock onUnlocked={() => void refresh()} />
      ) : (
        <Routes route={route} />
      )}
      <ApprovalSheet />
    </>
  );
}

export function App(props: { wallet: MobileWallet; initialRoute?: Route }) {
  const [link, setLink] = useState<DeepLink>(null);
  useEffect(() => {
    const opts = { scheme: APP.scheme, universalHost: process.env.CLIP_ASSOCIATED_DOMAIN };
    void Linking.getInitialURL().then((u) => setLink(parseDeepLink(u, opts)));
    const sub = Linking.addEventListener("url", (e) => setLink(parseDeepLink(e.url, opts)));
    return () => sub.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <WalletProvider wallet={props.wallet} initialRoute={props.initialRoute}>
        <Shell pendingLink={link} clearLink={() => setLink(null)} />
      </WalletProvider>
    </SafeAreaProvider>
  );
}
