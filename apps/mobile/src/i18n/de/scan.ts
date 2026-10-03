import type en from "../en/scan";
export default {
  "m.scan.title": "Zum Verbinden scannen",
  "m.scan.allowCamera": "Kamera erlauben",
  "m.scan.cameraWhy": "Die Kamera wird nur genutzt, um den Verbindungscode zu lesen. Du kannst den Code stattdessen auch in den Einstellungen einfügen.",
  "m.scan.point": "Richte deine Kamera auf den QR-Code der App.",
  "m.scan.notWalletConnect": "Dieser QR-Code ist kein {wc}-Code.",
  "m.scan.found": "Gefunden. Wird verbunden…",
  "m.scan.pairing": "Kopplung gestartet. Die App fragt dich gleich, ob du dich verbinden möchtest.",
} satisfies Record<keyof typeof en, string>;
