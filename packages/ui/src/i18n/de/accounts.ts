import type en from "../en/accounts";
export default {
  "accounts.title": "Konten",
  "accounts.titleFor": "Konten für {host}",
  "accounts.chooseFor": "Wähle, welches Konto {host} sieht. Andere Apps behalten ihre eigene Auswahl.",
  "accounts.nameFor": "Name für {account}",
  "accounts.inUse": "Aktiv",
  "accounts.rename": "Umbenennen",
  "accounts.renameAccount": "{account} umbenennen",
  "accounts.use": "Nutzen",
  "accounts.useAccount": "{account} nutzen",
  "accounts.adding": "Wird hinzugefügt…",
  "accounts.add": "Konto hinzufügen",
  "accounts.useDefault": "Hier mein Standardkonto nutzen",
  "accounts.family.evm": "Ethereum-artig (ETH, USDC, Base, Arbitrum…)",
} satisfies Record<keyof typeof en, string>;
