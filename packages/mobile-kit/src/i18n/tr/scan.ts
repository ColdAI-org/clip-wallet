import type en from "../en/scan";
export default {
  "m.scan.title": "Bağlanmak için tarayın",
  "m.scan.allowCamera": "Kameraya izin ver",
  "m.scan.cameraWhy": "Kamera yalnızca bağlantı kodunu okumak için kullanılır. Dilerseniz bunun yerine kodu Ayarlar'a yapıştırın.",
  "m.scan.found": "Bulundu. Bağlanıyor…",
  "m.scan.pairing": "Eşleştirme başladı. Uygulama sizden bağlanmanızı isteyecek.",
  "m.scan.pointOrTrade": "Kameranızı uygulamanın QR koduna veya bir takas bağlantısına doğrultun.",
  "m.scan.notConnectOrTrade": "Bu QR kodu bir bağlantı kodu ya da takas bağlantısı değil.",
} satisfies Record<keyof typeof en, string>;
