---
"@clip-wallet/config": minor
"@clip-wallet/extension-kit": minor
"@clip-wallet/features": patch
---

SODAX swaps are set up from the build environment only, with no defaults: `CLIP_SODAX_SERVER_URL` (an ExClip server
that quotes them) and `CLIP_SODAX_FEE_RECEIVER` (where the 0.875 % Clip fee goes), exported as `SODAX_SERVER_ENV` and
`SODAX_FEE_RECEIVER_ENV`. `clipWallet()` passes them to the background only in a mainnet build that sets both
(`sodaxFor()`), and only then adds host permissions for the server's origin and Sonic's RPC. The mainnet checklist
gains the SODAX items: `mainnetProblems()` asks for both settings (the server over https, the receiver an address) once
either is set, and the extension build refuses a receiver that isn't on the reviewed list (`sodaxProblems()`). A build
without them offers no SODAX swaps. Features exports `SONIC_RPC_URL`.
