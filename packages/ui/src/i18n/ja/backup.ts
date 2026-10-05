import type en from "../en/backup";
export default {
  // Recovery phrase
  "backup.phrase.screen": "リカバリーフレーズ",
  "backup.phrase.listLabel": "リカバリーフレーズ",
  "backup.phrase.quizMismatch": "一致しません。書き留めた内容を確認するか、もう一度フレーズを表示してください。",
  "backup.phrase.quizTitle": "控えを確認",
  "backup.phrase.quizLede": "書き留めた内容から、次の単語を入力してください。",
  "backup.phrase.quizWord": "{n}番目の単語",
  "backup.phrase.quizCheck": "確認",
  "backup.phrase.showAgain": "フレーズをもう一度表示",
  "backup.phrase.introTitle": "リカバリーフレーズをバックアップ",
  "backup.phrase.introLede":
    "この端末をなくしたとき、ウォレットを取り戻す唯一の方法がこの単語です。これを見た人は誰でも、すべての資産を奪うことができます。紙に書き留めてください。スクリーンショットや写真を撮ったり、どこかに貼り付けたりしないでください。",
  "backup.phrase.checking": "確認中…",
  "backup.phrase.doneTitle": "バックアップが完了しました",
  "backup.phrase.doneLede": "紙は安全で人目につかない場所に保管してください。私たちがこの単語を尋ねることは決してありません。",
  "backup.phrase.title": "あなたのリカバリーフレーズ",
  "backup.phrase.lede": "画面を誰にも見られていないことを確認してください。ボタンを長押しすると単語が表示され、クリックすると表示したままになります。",
  "backup.phrase.hide": "単語を隠す",
  "backup.phrase.reveal": "長押しまたはクリックで表示",
  "backup.phrase.allowCopy": "コピーを許可",
  "backup.phrase.allowCopyHint": "初期設定ではオフです。コピーした内容は、ほかのアプリや拡張機能が読み取れます。",
  "backup.phrase.writtenDown": "書き留めました",

  // Shared
  "backup.passwordLabel": "ウォレットのパスワード",
  "backup.waiting": "端末の応答を待っています…",
  "backup.passwordMismatch": "パスワードが一致しません。",

  // Passkey backup explainer
  "backup.explainer.lede": "パスキーでリカバリーフレーズのコピーをロックしておくと、新しい端末でウォレットを取り戻せます。",
  "backup.explainer.stored": "私たちが保管するのはロックされたコピーだけです。私たちには開けず、サーバーに侵入した人にも開けません。",
  "backup.explainer.keepPhrase": "リカバリーフレーズも書き留めておいてください。このサービスやパスキーがなくなっても使えます。",

  // Email sign-in
  "backup.signIn.email": "メールアドレス",
  "backup.signIn.emailHint": "サインイン用のリンクをメールでお送りします。パスワードは不要です。",
  "backup.signIn.sending": "送信中…",
  "backup.signIn.send": "リンクをメールで受け取る",
  "backup.signIn.sent": "<b>{email}</b> にリンクを送りました。この端末で開くか、ここに貼り付けてください。リンクは1回だけ、15分間有効です。",
  "backup.signIn.link": "メールに記載されたリンク",
  "backup.signIn.checking": "確認中…",
  "backup.signIn.otherEmail": "別のメールアドレスを使う",
  "backup.signIn.landingLoading": "サインインしています",
  "backup.signIn.landingDone": "サインインしました",

  // Passkey backup (settings)
  "backup.passkey.screen": "パスキーでのバックアップ",
  "backup.passkey.unavailableTitle": "このバージョンではパスキーでのバックアップを利用できません",
  "backup.passkey.unavailableBody": "リカバリーフレーズがバックアップになります。",
  "backup.passkey.noPasskeys": "このブラウザではパスキーを利用できません。リカバリーフレーズは引き続きバックアップとして使えます。",
  "backup.passkey.title": "パスキーでバックアップ",
  "backup.passkey.backedUp": "バックアップしました。新しい端末で、メールアドレスとこのパスキーを使って復元できます。",
  "backup.passkey.yourBackups": "あなたのバックアップ",
  "backup.passkey.made": "{date}に作成",
  "backup.passkey.signedInAs": "{email} でサインイン中",
  "backup.passkey.understand": "誰がウォレットを復元できるかを理解しました",
  "backup.passkey.create": "バックアップ用パスキーを作成",
  "backup.passkey.addAnother": "バックアップを追加",
  "backup.passkey.signOut": "バックアップからサインアウト",

  // Restore
  "backup.restore.screen": "復元",
  "backup.restore.noPasskeys": "このブラウザではパスキーを利用できません。代わりにリカバリーフレーズを使用してください。",
  "backup.restore.title": "パスキーで復元",
  "backup.restore.noBackupsTitle": "このメールアドレスのバックアップはありません",
  "backup.restore.noBackupsBody": "代わりにリカバリーフレーズを使うか、別のメールアドレスでサインインしてください。",
  "backup.restore.backupsLabel": "バックアップ",
  "backup.restore.backupFrom": "{date}のバックアップ",
  "backup.restore.newPassword": "この端末用の新しいパスワード",
  "backup.restore.passwordHint": "8文字以上。",
  "backup.restore.again": "もう一度入力",
  "backup.restore.unlock": "パスキーでロック解除",

  // Backup hub
  "backup.hub.screen": "バックアップ",
  "backup.hub.lede": "この端末をなくしたとき、ウォレットに戻る方法はバックアップだけです。",
  "backup.hub.phraseTitle": "リカバリーフレーズ",
  "backup.hub.phraseHint": "12個の単語を紙に書き留め、安全な場所に保管してください。対応するどのウォレットでも、ずっと使えます。",
  "backup.hub.phraseButton": "リカバリーフレーズをバックアップ",
  "backup.hub.passkeyTitle": "パスキーでのバックアップ",
  "backup.hub.passkeyUnavailable": "このバージョンではパスキーでのバックアップを利用できません。リカバリーフレーズがバックアップになります。",
  "backup.hub.passkeyStored":
    "ロックされたコピーが{count, plural, other {#件}}保管されています。新しい端末では、パスキーでロックを解除します。",
  "backup.hub.passkeyPitch": "リカバリーフレーズのコピーをパスキーでロックしておくと、新しい端末でメールアドレスとそのパスキーを使って復元できます。",
  "backup.hub.passkeyManage": "パスキーでのバックアップを管理",
  "backup.hub.passkeyStart": "パスキーでバックアップ",

  // platform/ceremony.ts
  "backup.ceremony.unknownPasskey": "このバックアップを作成したパスキーを特定できませんでした。",

  // account family names
  "backup.family.evm": "Ethereum系（ETH、USDC、Base、Arbitrum…）",
  "backup.family.hedera": "Hedera（HBAR）",
  "backup.family.solana": "Solana（SOL）",
  "backup.family.bitcoin": "Bitcoin（BTC）",
  "backup.explainer.restoreAny": "復元するには、新しい端末で、サインインに使ったメールアドレス、Google アカウントまたは Apple アカウント（コピーの取得用）と、パスキー（ロック解除用）が必要です。サインインで見つけられるのはコピーだけで、ロックを解除することはできません。",
  "backup.explainer.syncAny": "<b>パスキーは、Apple、Google またはパスワードマネージャーのアカウントを通じて同期されます。</b>そのアカウントを管理し、Face ID、指紋または PIN を通過できる人が、バックアップに使うメールアドレス、Google アカウントまたは Apple アカウントにも入れた場合、このウォレットを復元できてしまいます。両方を守ってください。",
  "backup.signIn.orEmail": "またはメールアドレスを使う：",
  "backup.social.google": "Google で続行",
  "backup.social.apple": "Appleでサインイン",
  "backup.social.privacy": "Google や Apple が私たちに伝えるのは、どのバックアップがあなたのものかだけです。鍵を見られることはなく、バックアップはパスキーでロックされたままです。",
  "backup.social.googleAccount": "Google アカウント",
  "backup.social.appleAccount": "Apple アカウント",
} satisfies Record<keyof typeof en, string>;
