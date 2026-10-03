import { createContext, useContext, type ReactNode } from "react";
import type { HardwareApprovalClient, HardwareClient } from "./types";

export type FullHardwareClient = HardwareClient & HardwareApprovalClient;

const HardwareContext = createContext<FullHardwareClient | null>(null);

/** Hardware wallets (Ledger, Keystone). Without a provider every hardware entry point is hidden. */
export function HardwareProvider(props: { client: FullHardwareClient; children: ReactNode }) {
  return <HardwareContext.Provider value={props.client}>{props.children}</HardwareContext.Provider>;
}

export function useHardwareOptional(): FullHardwareClient | null {
  return useContext(HardwareContext);
}
