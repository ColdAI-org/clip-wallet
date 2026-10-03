import type en from "../en/scan";
export default {
  "m.scan.title": "Escanear para conectar",
  "m.scan.allowCamera": "Permitir câmera",
  "m.scan.cameraWhy": "A câmera é usada apenas para ler o código de conexão. Ou cole o código em Configurações.",
  "m.scan.point": "Aponte a câmera para o código QR do app.",
  "m.scan.notWalletConnect": "Esse código QR não é um código {wc}.",
  "m.scan.found": "Encontrado. Conectando…",
  "m.scan.pairing": "Pareamento iniciado. O app vai pedir para você conectar.",
} satisfies Record<keyof typeof en, string>;
