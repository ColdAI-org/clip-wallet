import type en from "../en/scan";
export default {
  "m.scan.title": "Bağlanmak için tarayın",
  "m.scan.allowCamera": "Kameraya izin ver",
  "m.scan.cameraWhy": "Kamera yalnızca bağlantı kodunu okumak için kullanılır. Dilerseniz bunun yerine kodu Ayarlar'a yapıştırın.",
  "m.scan.point": "Kameranızı uygulamanın QR koduna doğrultun.",
  "m.scan.notWalletConnect": "Bu QR kodu bir {wc} kodu değil.",
  "m.scan.found": "Bulundu. Bağlanıyor…",
  "m.scan.pairing": "Eşleştirme başladı. Uygulama sizden bağlanmanızı isteyecek.",
} satisfies Record<keyof typeof en, string>;
