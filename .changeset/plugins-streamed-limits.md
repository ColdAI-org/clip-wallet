---
"@clip-wallet/plugins": patch
---

Size limits hold while downloading: a plugin's network fetch (256 KB), the npm tarball (5 MB) and npm's listing
(16 MB) are read as a stream and cut off past their limit (a larger Content-Length is refused before reading); an
oversized fetch now fails instead of arriving truncated. Bundles between 256 KB and the 1 MB install limit start
(the sandbox accepted only 256 KB messages), and whole 256 KB fetch bodies reach the plugin. New exports
`readBodyCapped`, `readTextCapped`, `BodyTooLargeError`, `MAX_METADATA_BYTES`. Audit PLG-02.
