/**
 * Keystone's QR codes on a phone: the extension's AnimatedQr / UrScanner (packages/ui/src/hardware/qr.tsx)
 * with React Native parts.
 *   AnimatedUrQr  loops a UR (BC-UR fountain parts from @clip-wallet/hardware's AnimatedUr) through the kit's
 *                 react-native-svg QR, 5 frames a second; a still code when it fits in one frame.
 *   UrScanner     expo-camera's barcode scanner feeds every QR it reads to UrCollector until the expected UR
 *                 is complete (parts arrive in any order; other codes in view are ignored).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { AnimatedUr, UrCollector, WrongUrType, urFromJson, urToJson, type UrJson } from "@clip-wallet/hardware/qr";
import { userMessageOf } from "@clip-wallet/ui";
import { useWallet } from "./context";
import { Button, ErrorNote, Qr, T } from "./kit";

export function AnimatedUrQr(props: { ur: UrJson; label: string; fps?: number; fragment?: number; size?: number }) {
  const { type, cborHex } = props.ur;
  const anim = useMemo(() => new AnimatedUr(urFromJson({ type, cborHex }), props.fragment ?? 200), [type, cborHex, props.fragment]);
  const [frame, setFrame] = useState(() => anim.next());
  useEffect(() => {
    setFrame(anim.next());
    if (!anim.animated) return;
    const t = setInterval(() => setFrame(anim.next()), 1000 / (props.fps ?? 5));
    return () => clearInterval(t);
  }, [anim, props.fps]);
  return (
    <View testID="ur-qr" accessibilityLabel={props.label}>
      <Qr value={frame} label={props.label} size={props.size ?? 260} />
    </View>
  );
}

export function UrScanner(props: { expect: string[]; onComplete: (ur: UrJson) => void; label?: string }) {
  const { theme } = useWallet();
  const [permission, request] = useCameraPermissions();
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const expectKey = props.expect.join(",");
  const collector = useMemo(() => new UrCollector(expectKey.split(",")), [expectKey]);
  const done = useRef(false);

  const onText = (text: string) => {
    if (done.current) return;
    try {
      const p = collector.receive(text);
      setProgress(p.progress);
      if (p.done) {
        done.current = true;
        props.onComplete(urToJson(collector.result()));
      }
    } catch (e) {
      setErr(e instanceof WrongUrType ? "That's a different QR code. Scan the one your Keystone shows for this step." : userMessageOf(e));
    }
  };

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ gap: 12 }}>
        <T v="lede">The camera is only used to read your Keystone's QR codes.</T>
        <Button block onPress={() => void request()} testID="allow-camera">
          Allow camera
        </Button>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={{ height: 320, borderRadius: theme.r.lg, overflow: "hidden", backgroundColor: theme.c.surface2 }} accessibilityLabel={props.label ?? "Camera preview"}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={done.current ? undefined : ({ data }) => onText(data)} testID="ur-camera" />
      </View>
      <T v="hint" testID="ur-progress">
        {progress > 0 && progress < 1 ? `Reading… ${Math.round(progress * 100)}%` : "Hold the code steady in front of the camera."}
      </T>
      <ErrorNote message={err} />
    </View>
  );
}
