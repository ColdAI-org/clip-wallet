import type en from "../en/accounts";
export default {
  "accounts.title": "Comptes",
  "accounts.titleFor": "Comptes pour {host}",
  "accounts.chooseFor": "Choisissez le compte que {host} voit. Les autres applications gardent leur propre choix.",
  "accounts.nameFor": "Nom de {account}",
  "accounts.inUse": "Utilisé",
  "accounts.rename": "Renommer",
  "accounts.renameAccount": "Renommer {account}",
  "accounts.use": "Utiliser",
  "accounts.useAccount": "Utiliser {account}",
  "accounts.adding": "Ajout…",
  "accounts.add": "Ajouter un compte",
  "accounts.useDefault": "Utiliser mon compte par défaut ici",
  "accounts.family.evm": "Type Ethereum (ETH, USDC, Base, Arbitrum…)",
} satisfies Record<keyof typeof en, string>;
