// Check a manifest the way the wallet does before anyone sees an install prompt.
import { describePermissions, parseManifest } from "@clip-wallet/plugins";
import manifest from "./plugin-manifest.json" with { type: "json" };

const real = { ...manifest, bundle: { ...manifest.bundle, sha256: "a".repeat(64) } }; // your bundle's real hash
const parsed = parseManifest(real); // throws ManifestError with a short reason when something is wrong
for (const line of describePermissions(parsed)) console.log(`• ${line}`);
// • See the requests you're asked to approve and add notes to them. Notes are marked "from Address labels".
// • It can never sign, move your funds, or see your recovery phrase or keys.
