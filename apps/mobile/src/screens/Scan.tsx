/** Scan a WalletConnect QR code with the camera (expo-camera). Only "wc:" URIs are accepted. */
import { useState } from "react";
import { View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { isWalletConnectUri, userMessageOf } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, ErrorNote, Notice, Screen, T } from "../ui/kit";
import { useMobileT } from "../i18n";

export function Scan() {
  const { client, back } = useWallet();
  const t = useMobileT();
  const [permission, request] = useCameraPermissions();
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!permission) return <Screen back title={t("m.scan.title")}>{null}</Screen>;
  if (!permission.granted) {
    return (
      <Screen back title={t("m.scan.title")} footer={<Button block onPress={request}>{t("m.scan.allowCamera")}</Button>}>
        <T v="lede">{t("m.scan.cameraWhy")}</T>
      </Screen>
    );
  }
  return (
    <Screen back title={t("m.scan.title")}>
      <View style={{ height: 360, borderRadius: 20, overflow: "hidden" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            busy
              ? undefined
              : async ({ data }) => {
                  if (!isWalletConnectUri(data)) {
                    setErr(t("m.scan.notWalletConnect", { wc: "WalletConnect" }));
                    return;
                  }
                  setBusy(true);
                  setErr(null);
                  setStatus(t("m.scan.found"));
                  try {
                    await client.pairWalletConnect(data);
                    setStatus(t("m.scan.pairing"));
                    setTimeout(back, 800);
                  } catch (e) {
                    setErr(userMessageOf(e));
                    setBusy(false);
                  }
                }
          }
        />
      </View>
      <Notice level="info">{status ?? t("m.scan.point")}</Notice>
      <ErrorNote message={err} />
    </Screen>
  );
}
