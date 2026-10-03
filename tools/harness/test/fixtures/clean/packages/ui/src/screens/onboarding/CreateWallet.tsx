import { createVault } from "@clip-wallet/vault";
const url = "https://example.org/a//b"; // a URL with // inside a string is not a comment
export default function CreateWallet() {
  return `${url}${String(createVault)}`;
}
