import type { Warning } from "@clip-wallet/core";

/** Shape of WalletConnect's Verify API context (`@walletconnect/types` Verify.Context). */
export interface VerifyContextLike {
  verified: {
    origin: string;
    validation: "UNKNOWN" | "VALID" | "INVALID";
    verifyUrl: string;
    isScam?: boolean;
  };
}

export type Verification = "verified" | "unverified" | "mismatch" | "scam";

export interface VerifyAssessment {
  /** Origin to attribute the request to: the Verify-attested one when VALID, else the app's claim. */
  origin: string;
  verification: Verification;
  warnings: Warning[];
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Turns Verify API output (plus an optional local blocklist) into approval-screen warnings.
 * https://docs.reown.com/walletkit/web/verify
 */
export function assessVerify(
  ctx: VerifyContextLike | undefined,
  claimedUrl: string | undefined,
  isKnownScam?: (origin: string) => boolean,
): VerifyAssessment {
  const claimed = originOf(claimedUrl) ?? claimedUrl ?? "unknown";
  const verifiedOrigin = originOf(ctx?.verified.origin) ?? ctx?.verified.origin;
  const warnings: Warning[] = [];
  let verification: Verification = "unverified";
  let origin = claimed;

  if (ctx?.verified.isScam || (isKnownScam && (isKnownScam(claimed) || (verifiedOrigin && isKnownScam(verifiedOrigin))))) {
    verification = "scam";
    warnings.push({
      level: "danger",
      code: "known-scam",
      message: "This app is on a list of known scams. Do not connect or sign anything.",
    });
  }

  if (ctx?.verified.validation === "VALID" && verifiedOrigin) {
    origin = verifiedOrigin;
    if (verification !== "scam") verification = "verified";
  } else if (ctx?.verified.validation === "INVALID") {
    if (verification !== "scam") verification = "mismatch";
    warnings.push({
      level: "danger",
      code: "domain-mismatch",
      message: `This app says it is ${claimed}, but the request came from ${verifiedOrigin ?? "a different site"}.`,
    });
  }
  if (verifiedOrigin && claimed !== verifiedOrigin && ctx?.verified.validation !== "INVALID") {
    // Verified origin differs from the metadata URL the app sent: worth a caution even if VALID.
    warnings.push({
      level: "caution",
      code: "domain-mismatch",
      message: `This app's name points to ${claimed}, but it is running on ${verifiedOrigin}.`,
    });
  }
  return { origin, verification, warnings };
}
