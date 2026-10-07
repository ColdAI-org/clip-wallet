// The config the kit's unit tests run with (vitest aliases virtual:clip-wallet/config here).
import { defineConfig } from "@clip-wallet/config";

export default defineConfig({ name: "Test Wallet", rdns: "com.example.testwallet", networks: ["evm:*", "hedera"] });
export const icon = "data:image/svg+xml;base64,PHN2Zy8+";
