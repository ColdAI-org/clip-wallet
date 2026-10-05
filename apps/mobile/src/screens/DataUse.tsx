import { useT } from "@clip-wallet/i18n/react";
import { PRIVACY_CATALOGS, PRIVACY_SECTIONS } from "@clip-wallet/ui";
import { APP } from "../env";
import { Card, Screen, T } from "../ui/kit";

/**
 * Settings → Your data. The same reviewed wording as the extension (the "privacy" namespace in @clip-wallet/ui);
 * the long form is docs/legal/privacy-policy.md.
 */
export function DataUse() {
  const t = useT(PRIVACY_CATALOGS);
  return (
    <Screen title={t("privacy.title")} back>
      <T v="lede" testID="data-use">
        {t("privacy.lede", { name: APP.config.name })}
      </T>
      {PRIVACY_SECTIONS.map((s) => (
        <Card key={s} style={{ gap: 6 }}>
          <T style={{ fontWeight: "600" }}>{t(`privacy.${s}.title`)}</T>
          <T v="hint">{t(`privacy.${s}.body`)}</T>
        </Card>
      ))}
    </Screen>
  );
}
