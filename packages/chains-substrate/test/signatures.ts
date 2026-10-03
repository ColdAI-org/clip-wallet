/**
 * sr25519 signature fixtures, computed once offline (outside the repo) with a throwaway key that was discarded
 * afterwards (AGENTS.md rule 1: no signing code outside packages/vault, tests included). sr25519 signatures are
 * randomised, so tests only verify them (`@scure/sr25519` verify, signing context "substrate").
 *
 *  - transferSig: signingBytes of payloadJson(me, Balances.transfer_keep_alive(bob, 1.5 WND)) on Westend Asset Hub
 *  - rawSig: <Bytes>Sign in to example.org</Bytes>
 *  - buildTransferSig: buildTransfer(1 WND → bob) with the standard RPC mocks
 */
export const FIX = {
  pub: "30944fd710729d3e5f6a37c807b8addc4790f0ffe1c56a3c190fabf2680cc31f",
  bob: "29699b799d38ff33a0a722186972e05cf07b26a602407a52591e9a7cda1b94f1",
} as const;

export const SIGS = {
  "transferSig": "b412fb1261f459aecdaa06113e5450bdbddce02e7884efbd5cc10d2adb3eac5c6bfa02cb65786ac08b613f9173fd36d3a4bb86106c34ad8ce74542990cc9f98b",
  "rawSig": "50ec39bd9237bb2ebb7c368c0876f937365765f571445cda0ba7438a74faad55f8ed4adbb456bdacd96b008777e88e1185d40ee04825541b2faff1dce8a42183",
  "buildTransferSig": "e622c0579b7cdca677ae177a9d26c2693fc8cdfbf89cf47af954c0b28480ee6089ee1f98a73d5f3c121cec29f2d324628c708ae44c1a1a5236725dbe872c838f"
} as const;
