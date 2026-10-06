import type en from "../en/scan";
export default {
  "m.scan.title": "Scanner pour se connecter",
  "m.scan.allowCamera": "Autoriser la caméra",
  "m.scan.cameraWhy": "La caméra sert uniquement à lire le code de connexion. Vous pouvez aussi coller le code dans les Paramètres.",
  "m.scan.found": "Trouvé. Connexion…",
  "m.scan.pairing": "Association lancée. L'application va vous demander de vous connecter.",
  "m.scan.pointOrTrade": "Pointez votre caméra vers le code QR de l'application, ou vers un lien d'échange.",
  "m.scan.notConnectOrTrade": "Ce code QR n'est ni un code de connexion ni un lien d'échange.",
} satisfies Record<keyof typeof en, string>;
