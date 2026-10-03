import type en from "../en/onboarding";
export default {
  // Welcome
  "onboarding.welcome.lede": "Paranız, koleksiyon öğeleriniz ve uygulamalarınız tek bir yerde. Şimdilik yalnızca test ağları.",
  "onboarding.welcome.create": "Yeni cüzdan oluştur",
  "onboarding.welcome.import": "Zaten bir kurtarma ifadem var",
  "onboarding.welcome.hardware": "Donanım cüzdanı bağla",
  "onboarding.welcome.restorePasskey": "Geçiş anahtarı yedeğiyle geri yükle",

  // Password strength
  "onboarding.strength.meter": "Parola gücü",
  "onboarding.strength.empty": "boş",
  "onboarding.strength.labelWithHint": "{label} — {hint}",
  "onboarding.strength.tooCommon": "Çok yaygın",
  "onboarding.strength.tooCommonHint": "Bilinen kelimelerden ve ardışık sayılardan kaçının.",
  "onboarding.strength.tooShort": "Çok kısa",
  "onboarding.strength.tooShortHint": "En az 8 karakter kullanın.",
  "onboarding.strength.okay": "İdare eder",
  "onboarding.strength.okayHint": "Ne kadar uzun o kadar iyi — birbiriyle ilgisiz birkaç kelime deneyin.",
  "onboarding.strength.good": "İyi",
  "onboarding.strength.strong": "Güçlü",

  // Choose a password
  "onboarding.password.title": "Bir parola seçin",
  "onboarding.password.lede": "Bu parola, bu cihazda cüzdanın kilidini açar. Parola kurtarılamaz, ancak kurtarma ifadeniz cüzdanı her zaman geri yükleyebilir.",
  "onboarding.password.label": "Parola",
  "onboarding.password.again": "Tekrar yazın",
  "onboarding.password.mismatch": "Parolalar eşleşmiyor.",
  "onboarding.password.importWallet": "Cüzdanı içe aktar",
  "onboarding.password.createWallet": "Cüzdan oluştur",

  // Recovery phrase shown at creation
  "onboarding.phrase.title": "Kurtarma ifadeniz",
  "onboarding.phrase.lede":
    "Bu {count} kelime, cüzdanınızı geri almanın tek yoludur. Sırasıyla yazın ve çevrim dışı saklayın. Bu kelimelere sahip olan herkes her şeyinizi alabilir.",
  "onboarding.phrase.listLabel": "Kurtarma ifadesi",
  "onboarding.phrase.show": "İfademi göster",
  "onboarding.phrase.saved": "Bu kelimeleri yazdım",

  // Backup check
  "onboarding.confirm.title": "Yedeğinizi kontrol edin",
  "onboarding.confirm.lede": "Bu sıralardaki kelimeleri yazın.",
  "onboarding.confirm.word": "Kelime #{n}",
  "onboarding.confirm.mismatch": "Bu kelimeler eşleşmiyor. Yazdığınız kopyayı kontrol edip tekrar deneyin.",
  "onboarding.confirm.showAgain": "İfadeyi tekrar göster",
  "onboarding.confirm.submit": "Onayla",

  // Import
  "onboarding.import.title": "Cüzdanınızı içe aktarın",
  "onboarding.import.lede": "12 veya 24 kelimelik kurtarma ifadenizi, kelimeler arasında boşluk bırakarak girin.",
  "onboarding.import.label": "Kurtarma ifadesi",
  "onboarding.import.wordCount": "{n, plural, one {Şu ana kadar # kelime} other {Şu ana kadar # kelime}}",

  // Passkey offer during onboarding
  "onboarding.passkeyOffer.title": "Face ID veya Touch ID ile kilit açılsın mı?",
  "onboarding.passkeyOffer.lede": "Parolanızı yazmak yerine cihazınızın geçiş anahtarını kullanın. Parolanız çalışmaya devam eder.",
  "onboarding.passkeyOffer.notNow": "Şimdi değil",

  // Done
  "onboarding.done.title": "Her şey hazır",
  "onboarding.done.lede": "{name} hazır. İstediğiniz zaman tarayıcı araç çubuğunuzdan açabilirsiniz.",
  "onboarding.done.open": "Cüzdanımı aç",

  // Unlock
  "onboarding.unlock.title": "Tekrar hoş geldiniz",
  "onboarding.unlock.submit": "Kilidi aç",
  "onboarding.unlock.withPasskey": "Geçiş anahtarıyla kilidi aç",

  // Passkey enrol / unlock
  "onboarding.passkey.unavailable": "Geçiş anahtarları bu tarayıcıda kullanılamıyor. Parolanız hâlâ çalışır.",
  "onboarding.passkey.passwordLabel": "Cüzdan parolanız",
  "onboarding.passkey.waiting": "Cihazınız bekleniyor…",
  "onboarding.passkey.use": "Geçiş anahtarı kullan",
  "onboarding.passkey.enrollScreen": "Geçiş anahtarıyla kilit açma",
  "onboarding.passkey.enrollTitle": "Face ID veya Touch ID ile kilidi açın",
  "onboarding.passkey.enrollLede": "Parolanızı onaylayın; ardından cihazınız sizden {name} için bir geçiş anahtarı oluşturmanızı isteyecek.",
  "onboarding.passkey.unlockScreen": "Kilidi aç",
  "onboarding.passkey.unlocked": "Kilit açıldı",
  "onboarding.passkey.unlockTitle": "Geçiş anahtarınızla kilidi açın",

  // Passkey errors
  "onboarding.passkeyError.cancelled": "Geçiş anahtarı isteği iptal edildi. Tekrar deneyebilir veya parolanızı kullanabilirsiniz.",
  "onboarding.passkeyError.cancelledShort": "Geçiş anahtarı isteği iptal edildi.",
  "onboarding.passkeyError.unsupported": "Bu tarayıcı burada geçiş anahtarı kullanamıyor. Parolanız hâlâ çalışır.",
  "onboarding.passkeyError.failed": "Geçiş anahtarı yanıt vermedi. Parolanız hâlâ çalışır.",
  "onboarding.passkeyError.noPrf": "Bu geçiş anahtarı bir cüzdanın kilidini açamaz (PRF desteği yok). Parolanız hâlâ çalışır.",
  "onboarding.passkeyError.notSetUp": "Bu cihazda geçiş anahtarıyla kilit açma kurulmamış. Parolanızı kullanın.",
} satisfies Record<keyof typeof en, string>;
