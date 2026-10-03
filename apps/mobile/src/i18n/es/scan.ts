import type en from "../en/scan";
export default {
  "m.scan.title": "Escanear para conectar",
  "m.scan.allowCamera": "Permitir cámara",
  "m.scan.cameraWhy": "La cámara solo se usa para leer el código de conexión. También puedes pegar el código en Ajustes.",
  "m.scan.point": "Apunta la cámara al código QR de la app.",
  "m.scan.notWalletConnect": "Ese código QR no es un código de {wc}.",
  "m.scan.found": "Encontrado. Conectando…",
  "m.scan.pairing": "Vinculación iniciada. La app te pedirá que te conectes.",
} satisfies Record<keyof typeof en, string>;
