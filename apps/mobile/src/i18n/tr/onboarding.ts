import type en from "../en/onboarding";
export default {
  "m.onboarding.strength.a11y": "Parola gücü: {level}",
  "m.onboarding.strength.empty": "boş",
  "m.onboarding.strength.tooCommon": "Çok yaygın",
  "m.onboarding.strength.tooCommon.hint": "Bilinen kelimelerden ve ardışık sayılardan kaçının.",
  "m.onboarding.strength.tooShort": "Çok kısa",
  "m.onboarding.strength.tooShort.hint": "En az 8 karakter kullanın.",
  "m.onboarding.strength.okay": "İdare eder",
  "m.onboarding.strength.okay.hint": "Ne kadar uzun o kadar iyi — birbiriyle ilgisiz birkaç kelime deneyin.",
  "m.onboarding.strength.good": "İyi",
  "m.onboarding.strength.strong": "Güçlü",
  "m.onboarding.strength.withHint": "{label} — {hint}",

  "m.onboarding.welcome.lede": "Paranız, koleksiyon öğeleriniz ve uygulamalarınız tek bir yerde. Şimdilik yalnızca test ağları.",
  "m.onboarding.welcome.create": "Yeni cüzdan oluştur",
  "m.onboarding.welcome.import": "Zaten bir kurtarma ifadem var",

  "m.onboarding.password.title": "Bir parola seçin",
  "m.onboarding.password.lede": "Bu parola, bu cihazda cüzdanın kilidini açar. Parola kurtarılamaz, ancak kurtarma ifadeniz cüzdanı her zaman geri yükleyebilir.",
  "m.onboarding.password.label": "Parola",
  "m.onboarding.password.again": "Tekrar yazın",
  "m.onboarding.password.mismatch": "Parolalar eşleşmiyor.",
  "m.onboarding.password.busy": "Cüzdanınız güvenceye alınıyor…",
  "m.onboarding.password.create": "Cüzdan oluştur",
  "m.onboarding.password.import": "Cüzdanı içe aktar",

  "m.onboarding.phrase.title": "Kurtarma ifadeniz",
  "m.onboarding.phrase.lede":
    "{n, plural, one {Bu kelime, cüzdanınızı geri almanın tek yoludur. Yazın ve çevrim dışı saklayın. Bu kelimeye sahip olan herkes her şeyinizi alabilir.} other {Bu # kelime, cüzdanınızı geri almanın tek yoludur. Sırasıyla yazın ve çevrim dışı saklayın. Bu kelimelere sahip olan herkes her şeyinizi alabilir.}}",
  "m.onboarding.phrase.a11y": "Kurtarma ifadesi",
  "m.onboarding.phrase.reveal": "İfademi göster",
  "m.onboarding.phrase.saved": "Bu kelimeleri yazdım",

  "m.onboarding.confirm.title": "Yedeğinizi kontrol edin",
  "m.onboarding.confirm.lede": "Bu sıralardaki kelimeleri yazın.",
  "m.onboarding.confirm.word": "Kelime #{n}",
  "m.onboarding.confirm.button": "Onayla",
  "m.onboarding.confirm.mismatch": "Bu kelimeler eşleşmiyor. Yazdığınız kopyayı kontrol edip tekrar deneyin.",

  "m.onboarding.import.title": "Cüzdanınızı içe aktarın",
  "m.onboarding.import.lede": "12 veya 24 kelimelik kurtarma ifadenizi, kelimeler arasında boşluk bırakarak girin.",
  "m.onboarding.import.label": "Kurtarma ifadesi",
  "m.onboarding.import.count": "{n, plural, one {Şu ana kadar # kelime} other {Şu ana kadar # kelime}}",

  "m.onboarding.biometrics.either": "{face} veya {touch}",
  "m.onboarding.biometrics.use": "{label} kullan",
  "m.onboarding.biometrics.notNow": "Şimdi değil",
  "m.onboarding.biometrics.title": "{label} ile kilit açılsın mı?",
  "m.onboarding.biometrics.lede": "Parolanızı yazmak yerine cihazınızı kullanın. Parolanız çalışmaya devam eder.",

  "m.onboarding.done.title": "Her şey hazır",
  "m.onboarding.done.lede": "{name} hazır.",
  "m.onboarding.done.open": "Cüzdanımı aç",

  "m.onboarding.unlock.title": "Tekrar hoş geldiniz",
  "m.onboarding.unlock.button": "Kilidi aç",
  "m.onboarding.unlock.biometrics": "{label} ile kilidi aç",
  "m.onboarding.unlock.passkey": "Geçiş anahtarıyla kilidi aç",
} satisfies Record<keyof typeof en, string>;
