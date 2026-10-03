import { createContext, useContext, type ReactNode } from "react";
import type { SecurityClient } from "./client";

const SecurityContext = createContext<SecurityClient | null>(null);

export function SecurityProvider(props: { client: SecurityClient; children: ReactNode }) {
  return <SecurityContext.Provider value={props.client}>{props.children}</SecurityContext.Provider>;
}

export function useSecurity(): SecurityClient {
  const v = useContext(SecurityContext);
  if (!v) throw new Error("useSecurity outside <SecurityProvider>");
  return v;
}

/** The security client when the app was given one (the extension and mobile pass it), else null. */
export function useSecurityOptional(): SecurityClient | null {
  return useContext(SecurityContext);
}
