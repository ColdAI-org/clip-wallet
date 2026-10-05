/** `?variant=clip`: the same stock picker with the documented module/entry a dapp adds for Clip Wallet. */
export const withClip = new URLSearchParams(location.search).get("variant") === "clip";
