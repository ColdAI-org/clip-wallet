import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, ErrorNote, Screen, Spinner } from "../components";
import { IconFingerprint, IconShield } from "../components/icons";
import { asPlatform } from "../platform/client";
import { useUiT } from "../i18n";

/**
 * Settings → Backup. Two ways to get the wallet back: the recovery phrase (always) and a passkey-locked copy
 * (only when this build has a backup service; otherwise a plain note says so and nothing else is offered).
 */
export function BackupHub() {
  const t = useUiT();
  const { client } = useUi();
  const { navigate } = useRouter();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), []);
  const st = status.data;

  return (
    <Screen title={t("backup.hub.screen")} back>
      <div className="clip-stack">
        <p className="clip-lede">{t("backup.hub.lede")}</p>
        <Card>
          <h2 className="clip-h2">
            <IconShield /> {t("backup.hub.phraseTitle")}
          </h2>
          <p className="clip-hint">{t("backup.hub.phraseHint")}</p>
          <Button block variant="secondary" onClick={() => navigate("/backup/phrase")}>
            {t("backup.hub.phraseButton")}
          </Button>
        </Card>
        <Card>
          <h2 className="clip-h2">
            <IconFingerprint /> {t("backup.hub.passkeyTitle")}
          </h2>
          {status.loading && !st ? (
            <Spinner />
          ) : !st ? (
            <ErrorNote message={userMessageOf(status.error)} />
          ) : !st.available ? (
            <p className="clip-hint" data-testid="passkey-backup-unavailable">
              {t("backup.hub.passkeyUnavailable")}
            </p>
          ) : (
            <>
              <p className="clip-hint">
                {st.backups.length > 0 ? t("backup.hub.passkeyStored", { count: st.backups.length }) : t("backup.hub.passkeyPitch")}
              </p>
              <Button block variant="secondary" onClick={() => navigate("/backup/passkey")}>
                {st.backups.length > 0 ? t("backup.hub.passkeyManage") : t("backup.hub.passkeyStart")}
              </Button>
            </>
          )}
        </Card>
      </div>
    </Screen>
  );
}
