// What the wallet UI puts in <img src>: the proxy URL, or null (show a placeholder, fetch nothing).
import { mediaProxyUrl } from "@clip-wallet/media-client";

const proxy = "https://media.acme.example"; // services.mediaProxyUrl in clip.config.ts

console.log(mediaProxyUrl(proxy, "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1.png"));
// { kind: "image", src: "https://media.acme.example/v1/media?src=ipfs%3A%2F%2Fbafy…%2F1.png&kind=image" }
console.log(mediaProxyUrl(proxy, "http://169.254.169.254/latest/meta-data/")); // null: private address
console.log(mediaProxyUrl(undefined, "https://example.com/cat.png")); // null: no proxy configured
