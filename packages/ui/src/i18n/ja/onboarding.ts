import type en from "../en/onboarding";
export default {
  // Welcome
  "onboarding.welcome.lede": "お金、コレクティブル、アプリをひとつの場所に。現在はテストネットワーク専用です。",
  "onboarding.welcome.create": "新しいウォレットを作成",
  "onboarding.welcome.import": "リカバリーフレーズを持っています",
  "onboarding.welcome.hardware": "ハードウェアウォレットを接続",
  "onboarding.welcome.restorePasskey": "パスキーのバックアップから復元",

  // Password strength
  "onboarding.strength.meter": "パスワードの強度",
  "onboarding.strength.empty": "未入力",
  "onboarding.strength.labelWithHint": "{label} — {hint}",
  "onboarding.strength.tooCommon": "よくあるパスワードです",
  "onboarding.strength.tooCommonHint": "よく知られた単語や連続した数字は避けてください。",
  "onboarding.strength.tooShort": "短すぎます",
  "onboarding.strength.tooShortHint": "8文字以上にしてください。",
  "onboarding.strength.okay": "普通",
  "onboarding.strength.okayHint": "長いほど安全です。関係のない単語をいくつか組み合わせてみてください。",
  "onboarding.strength.good": "良い",
  "onboarding.strength.strong": "強い",

  // Choose a password
  "onboarding.password.title": "パスワードを設定",
  "onboarding.password.lede": "この端末でウォレットのロックを解除するためのパスワードです。パスワードは復元できませんが、リカバリーフレーズがあればいつでもウォレットを復元できます。",
  "onboarding.password.label": "パスワード",
  "onboarding.password.again": "もう一度入力",
  "onboarding.password.mismatch": "パスワードが一致しません。",
  "onboarding.password.importWallet": "ウォレットをインポート",
  "onboarding.password.createWallet": "ウォレットを作成",

  // Recovery phrase shown at creation
  "onboarding.phrase.title": "あなたのリカバリーフレーズ",
  "onboarding.phrase.lede":
    "この{count}個の単語が、ウォレットを取り戻す唯一の方法です。順番どおりに紙に書き留め、オフラインで保管してください。これを知っている人は誰でも、すべての資産を奪うことができます。",
  "onboarding.phrase.listLabel": "リカバリーフレーズ",
  "onboarding.phrase.show": "フレーズを表示",
  "onboarding.phrase.saved": "単語を書き留めました",

  // Backup check
  "onboarding.confirm.title": "バックアップを確認",
  "onboarding.confirm.lede": "次の位置の単語を入力してください。",
  "onboarding.confirm.word": "{n}番目の単語",
  "onboarding.confirm.mismatch": "単語が一致しません。書き留めた内容を確認して、もう一度お試しください。",
  "onboarding.confirm.showAgain": "フレーズをもう一度表示",
  "onboarding.confirm.submit": "確認",

  // Import
  "onboarding.import.title": "ウォレットをインポート",
  "onboarding.import.lede": "12語または24語のリカバリーフレーズを、スペースで区切って入力してください。",
  "onboarding.import.label": "リカバリーフレーズ",
  "onboarding.import.wordCount": "{n, plural, other {現在#語}}",

  // Passkey offer during onboarding
  "onboarding.passkeyOffer.title": "Face ID または Touch ID でロックを解除しますか？",
  "onboarding.passkeyOffer.lede": "パスワードを入力する代わりに、端末のパスキーを使用できます。パスワードも引き続き使えます。",
  "onboarding.passkeyOffer.notNow": "今はしない",

  // Done
  "onboarding.done.title": "準備が整いました",
  "onboarding.done.lede": "{name}の準備ができました。ブラウザのツールバーからいつでも開けます。",
  "onboarding.done.open": "ウォレットを開く",

  // Unlock
  "onboarding.unlock.title": "おかえりなさい",
  "onboarding.unlock.submit": "ロック解除",
  "onboarding.unlock.withPasskey": "パスキーでロック解除",

  // Passkey enrol / unlock
  "onboarding.passkey.unavailable": "このブラウザではパスキーを利用できません。パスワードは引き続き使えます。",
  "onboarding.passkey.passwordLabel": "ウォレットのパスワード",
  "onboarding.passkey.waiting": "端末の応答を待っています…",
  "onboarding.passkey.use": "パスキーを使う",
  "onboarding.passkey.enrollScreen": "パスキーでロック解除",
  "onboarding.passkey.enrollTitle": "Face ID または Touch ID でロック解除",
  "onboarding.passkey.enrollLede": "パスワードを確認すると、端末から{name}用のパスキーの作成を求められます。",
  "onboarding.passkey.unlockScreen": "ロック解除",
  "onboarding.passkey.unlocked": "ロックを解除しました",
  "onboarding.passkey.unlockTitle": "パスキーでロック解除",

  // Passkey errors
  "onboarding.passkeyError.cancelled": "パスキーのリクエストがキャンセルされました。もう一度試すか、パスワードを使用してください。",
  "onboarding.passkeyError.cancelledShort": "パスキーのリクエストがキャンセルされました。",
  "onboarding.passkeyError.unsupported": "このブラウザではここでパスキーを使用できません。パスワードは引き続き使えます。",
  "onboarding.passkeyError.failed": "パスキーが応答しませんでした。パスワードは引き続き使えます。",
  "onboarding.passkeyError.noPrf": "このパスキーではウォレットのロックを解除できません（PRF非対応）。パスワードは引き続き使えます。",
  "onboarding.passkeyError.notSetUp": "この端末ではパスキーによるロック解除が設定されていません。パスワードを使用してください。",
} satisfies Record<keyof typeof en, string>;
