import { createContext, useContext, type ReactNode } from "react";
import type { FeaturesClient } from "./client";

const FeaturesContext = createContext<FeaturesClient | null>(null);

export function FeaturesProvider(props: { client: FeaturesClient; children: ReactNode }) {
  return <FeaturesContext.Provider value={props.client}>{props.children}</FeaturesContext.Provider>;
}

export function useFeatures(): FeaturesClient {
  const v = useContext(FeaturesContext);
  if (!v) throw new Error("useFeatures outside <FeaturesProvider>");
  return v;
}

/** The features client when the app was given one (the extension and mobile pass it), else null. */
export function useFeaturesOptional(): FeaturesClient | null {
  return useContext(FeaturesContext);
}
