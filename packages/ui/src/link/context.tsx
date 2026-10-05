import { createContext, useContext, type ReactNode } from "react";
import type { LinkClient } from "./client";

const LinkContext = createContext<LinkClient | null>(null);

export function LinkProvider(props: { client: LinkClient; children: ReactNode }) {
  return <LinkContext.Provider value={props.client}>{props.children}</LinkContext.Provider>;
}

export function useLink(): LinkClient {
  const v = useContext(LinkContext);
  if (!v) throw new Error("useLink outside <LinkProvider>");
  return v;
}

/** The link client when the app was given one (extension, mobile), else null. */
export function useLinkOptional(): LinkClient | null {
  return useContext(LinkContext);
}
