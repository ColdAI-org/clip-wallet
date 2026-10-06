---
"@clip-wallet/media-client": patch
---

`isBlockedHost()` parses the host with the WHATWG URL parser (new `parseHost()`) and compares addresses by range and
names by label: IPv4 in any spelling (`127.1`, `0x7f.0.0.1`), documentation, benchmark and reserved ranges, and
private-use names (`.lan`, `.home`, `.corp`, `.test`, …) are now refused; public names that only contain such words
aren't. Audit MEDIA-01.
