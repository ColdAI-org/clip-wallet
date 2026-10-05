import { Card, Screen } from "../components";
import { useUi } from "../context";
import { useUiT } from "../i18n";
import { PRIVACY_SECTIONS } from "../i18n/privacy";

/**
 * Settings → Your data: what stays on the device, what the wallet asks the internet, and what only happens when
 * the user turns something on. The long form is docs/legal/privacy-policy.md; keep both saying the same thing.
 */
export function DataUse() {
  const t = useUiT();
  const { config } = useUi();
  return (
    <Screen title={t("privacy.title")} back>
      <div className="clip-stack" data-testid="data-use">
        <p className="clip-lede">{t("privacy.lede", { name: config.name })}</p>
        {PRIVACY_SECTIONS.map((s) => (
          <Card key={s}>
            <h2 className="clip-h2">{t(`privacy.${s}.title`)}</h2>
            <p className="clip-hint">{t(`privacy.${s}.body`)}</p>
          </Card>
        ))}
      </div>
    </Screen>
  );
}
