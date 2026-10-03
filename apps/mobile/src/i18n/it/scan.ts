import type en from "../en/scan";
export default {
  "m.scan.title": "Scansiona per collegarti",
  "m.scan.allowCamera": "Consenti fotocamera",
  "m.scan.cameraWhy": "La fotocamera serve solo a leggere il codice di connessione. In alternativa, incolla il codice nelle Impostazioni.",
  "m.scan.point": "Inquadra il codice QR dell'app con la fotocamera.",
  "m.scan.notWalletConnect": "Questo codice QR non è un codice {wc}.",
  "m.scan.found": "Trovato. Collegamento in corso…",
  "m.scan.pairing": "Abbinamento avviato. L'app ti chiederà di collegarti.",
} satisfies Record<keyof typeof en, string>;
