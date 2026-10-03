import { createContext, useContext, type ReactNode } from "react";
import type { SocialClient } from "./client";

const SocialContext = createContext<SocialClient | null>(null);

export function SocialProvider(props: { client: SocialClient; children: ReactNode }) {
  return <SocialContext.Provider value={props.client}>{props.children}</SocialContext.Provider>;
}

export function useSocial(): SocialClient {
  const v = useContext(SocialContext);
  if (!v) throw new Error("useSocial outside <SocialProvider>");
  return v;
}

/** The social client when the app was given one, else null (contacts, handles, notifications and Discover hide). */
export function useSocialOptional(): SocialClient | null {
  return useContext(SocialContext);
}
