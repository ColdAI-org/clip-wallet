import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, ErrorNote, Screen, Spinner } from "../components";
import { IconFingerprint, IconShield } from "../components/icons";
import { asPlatform } from "../platform/client";

/**
 * Settings → Backup. Two ways to get the wallet back: the recovery phrase (always) and a passkey-locked copy
 * (only when this build has a backup service; otherwise a plain note says so and nothing else is offered).
 */
export function BackupHub() {
  const { client } = useUi();
  const { navigate } = useRouter();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), []);
  const st = status.data;

  return (
    <Screen title="Backup" back>
      <div className="clip-stack">
        <p className="clip-lede">If you lose this device, a backup is the only way back into your wallet.</p>
        <Card>
          <h2 className="clip-h2">
            <IconShield /> Recovery phrase
          </h2>
          <p className="clip-hint">Write the 12 words on paper and keep them somewhere safe. They work in any compatible wallet, forever.</p>
          <Button block variant="secondary" onClick={() => navigate("/backup/phrase")}>
            Back up recovery phrase
          </Button>
        </Card>
        <Card>
          <h2 className="clip-h2">
            <IconFingerprint /> Passkey backup
          </h2>
          {status.loading && !st ? (
            <Spinner />
          ) : !st ? (
            <ErrorNote message={userMessageOf(status.error)} />
          ) : !st.available ? (
            <p className="clip-hint" data-testid="passkey-backup-unavailable">
              Passkey backup isn't available in this version. Your recovery phrase is your backup.
            </p>
          ) : (
            <>
              <p className="clip-hint">
                {st.backups.length > 0
                  ? `${st.backups.length === 1 ? "1 locked copy is" : `${st.backups.length} locked copies are`} stored. Your passkey unlocks it on a new device.`
                  : "Lock a copy of your recovery phrase with a passkey, so you can restore on a new device with your email and that passkey."}
              </p>
              <Button block variant="secondary" onClick={() => navigate("/backup/passkey")}>
                {st.backups.length > 0 ? "Manage passkey backup" : "Back up with your passkey"}
              </Button>
            </>
          )}
        </Card>
      </div>
    </Screen>
  );
}
