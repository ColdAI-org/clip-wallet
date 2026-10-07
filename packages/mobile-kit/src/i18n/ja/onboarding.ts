import type en from "../en/onboarding";
export default {
  "m.onboarding.strength.a11y": "パスワードの強度：{level}",
  "m.onboarding.strength.empty": "未入力",
  "m.onboarding.strength.tooCommon": "よくあるパスワードです",
  "m.onboarding.strength.tooCommon.hint": "よく知られた単語や連続した数字は避けてください。",
  "m.onboarding.strength.tooShort": "短すぎます",
  "m.onboarding.strength.tooShort.hint": "8文字以上にしてください。",
  "m.onboarding.strength.okay": "普通",
  "m.onboarding.strength.okay.hint": "長いほど安全です。関係のない単語をいくつか組み合わせてみてください。",
  "m.onboarding.strength.good": "良い",
  "m.onboarding.strength.strong": "強い",
  "m.onboarding.strength.withHint": "{label} — {hint}",

  "m.onboarding.welcome.lede": "お金、コレクティブル、アプリをひとつの場所に。現在はテストネットワーク専用です。",
  "m.onboarding.welcome.create": "新しいウォレットを作成",
  "m.onboarding.welcome.import": "リカバリーフレーズを持っています",

  "m.onboarding.password.title": "パスワードを設定",
  "m.onboarding.password.lede": "この端末でウォレットのロックを解除するためのパスワードです。パスワードは復元できませんが、リカバリーフレーズがあればいつでもウォレットを復元できます。",
  "m.onboarding.password.label": "パスワード",
  "m.onboarding.password.again": "もう一度入力",
  "m.onboarding.password.mismatch": "パスワードが一致しません。",
  "m.onboarding.password.busy": "ウォレットを保護しています…",
  "m.onboarding.password.create": "ウォレットを作成",
  "m.onboarding.password.import": "ウォレットをインポート",

  "m.onboarding.phrase.title": "あなたのリカバリーフレーズ",
  "m.onboarding.phrase.lede":
    "{n, plural, other {この#個の単語が、ウォレットを取り戻す唯一の方法です。順番どおりに紙に書き留め、オフラインで保管してください。これを知っている人は誰でも、すべての資産を奪うことができます。}}",
  "m.onboarding.phrase.a11y": "リカバリーフレーズ",
  "m.onboarding.phrase.reveal": "フレーズを表示",
  "m.onboarding.phrase.saved": "単語を書き留めました",

  "m.onboarding.confirm.title": "バックアップを確認",
  "m.onboarding.confirm.lede": "次の位置の単語を入力してください。",
  "m.onboarding.confirm.word": "{n}番目の単語",
  "m.onboarding.confirm.button": "確認",
  "m.onboarding.confirm.mismatch": "単語が一致しません。書き留めた内容を確認して、もう一度お試しください。",

  "m.onboarding.import.title": "ウォレットをインポート",
  "m.onboarding.import.lede": "12語または24語のリカバリーフレーズを、スペースで区切って入力してください。",
  "m.onboarding.import.label": "リカバリーフレーズ",
  "m.onboarding.import.count": "{n, plural, other {現在#語}}",

  "m.onboarding.biometrics.either": "{face}または{touch}",
  "m.onboarding.biometrics.use": "{label}を使う",
  "m.onboarding.biometrics.notNow": "今はしない",
  "m.onboarding.biometrics.title": "{label}でロックを解除しますか？",
  "m.onboarding.biometrics.lede": "パスワードを入力する代わりに、端末を使ってロックを解除できます。パスワードも引き続き使えます。",

  "m.onboarding.done.title": "準備が整いました",
  "m.onboarding.done.lede": "{name}の準備ができました。",
  "m.onboarding.done.open": "ウォレットを開く",

  "m.onboarding.unlock.title": "おかえりなさい",
  "m.onboarding.unlock.button": "ロック解除",
  "m.onboarding.unlock.biometrics": "{label}でロック解除",
  "m.onboarding.unlock.passkey": "パスキーでロック解除",
} satisfies Record<keyof typeof en, string>;
