/** Scan a WalletConnect QR code with the camera (expo-camera). Only "wc:" URIs are accepted. */
import { useState } from "react";
import { View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { isWalletConnectUri, userMessageOf } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, ErrorNote, Notice, Screen, T } from "../ui/kit";

export function Scan() {
  const { client, back } = useWallet();
  const [permission, request] = useCameraPermissions();
  const [status, setStatus] = useState("Point your camera at the app's QR code.");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!permission) return <Screen back title="Scan to connect">{null}</Screen>;
  if (!permission.granted) {
    return (
      <Screen back title="Scan to connect" footer={<Button block onPress={request}>Allow camera</Button>}>
        <T v="lede">The camera is only used to read the connection code. Or paste the code in Settings instead.</T>
      </Screen>
    );
  }
  return (
    <Screen back title="Scan to connect">
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
                    setErr("That QR code isn't a WalletConnect code.");
                    return;
                  }
                  setBusy(true);
                  setErr(null);
                  setStatus("Found it. Connecting…");
                  try {
                    await client.pairWalletConnect(data);
                    setStatus("Pairing started. The app will ask you to connect.");
                    setTimeout(back, 800);
                  } catch (e) {
                    setErr(userMessageOf(e));
                    setBusy(false);
                  }
                }
          }
        />
      </View>
      <Notice level="info">{status}</Notice>
      <ErrorNote message={err} />
    </Screen>
  );
}
