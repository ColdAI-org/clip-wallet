/**
 * Foreground side of local notifications: while the app is open (AppState "active") and a wallet exists, check
 * for news every minute (the OS runs background checks far less often; background-task.ts), and send a tapped
 * notice to its screen.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { mergeBalances } from "@clip-wallet/ui";
import { onNotificationTap } from "../background/notifications";
import { useWallet } from "./context";
import { noticeTarget } from "../lib/notice-routes";

export const POLL_MS = 60_000;

export function useNotificationBridge(active: boolean) {
  const { wallet, client, navigate, showApproval } = useWallet();
  // Latest callbacks without re-registering the tap listener.
  const go = useRef<(route: string) => void>(() => undefined);
  go.current = (route) => {
    const target = noticeTarget(route);
    if (target.kind === "approval") return showApproval(target.id);
    if (target.kind === "activity" || target.kind === "collectibles") return navigate({ name: target.kind });
    if (target.kind === "asset") {
      void client.getPortfolio().then(
        (p) => {
          const asset = mergeBalances(p.balances, { showSpam: true }).assets.find((a) => a.key === target.key && !a.bridged);
          navigate(asset ? { name: "asset", id: asset.id } : { name: "home" });
        },
        () => navigate({ name: "home" }),
      );
      return;
    }
    navigate({ name: "home" });
  };

  useEffect(() => onNotificationTap((route) => go.current(route)), []);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () => void wallet.pollNotifications().catch(() => undefined);
    const start = () => {
      if (timer) return;
      poll();
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [wallet, active]);
}
