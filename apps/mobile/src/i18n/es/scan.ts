import type en from "../en/scan";
export default {
  "m.scan.title": "Escanear para conectar",
  "m.scan.allowCamera": "Permitir cámara",
  "m.scan.cameraWhy": "La cámara solo se usa para leer el código de conexión. También puedes pegar el código en Ajustes.",
  "m.scan.found": "Encontrado. Conectando…",
  "m.scan.pairing": "Vinculación iniciada. La app te pedirá que te conectes.",
  "m.scan.pointOrTrade": "Apunta la cámara al código QR de la app o a un enlace de operación.",
  "m.scan.notConnectOrTrade": "Ese código QR no es un código de conexión ni un enlace de operación.",
} satisfies Record<keyof typeof en, string>;
