---
"@clip-wallet/features": patch
---

A SODAX swap's review keeps the Clip fee, who receives it, the minimum you get and where it arrives even when the
network can't dry-run the swap and the review stays unreadable (blocked unless blind signing is allowed). Steps gain
`linesProven`: set only where `verify` proves every line from the request's own bytes, as SODAX's check does. Every
other step keeps the audited behaviour (FEAT-02): an unreadable review shows only what the chain module read.
