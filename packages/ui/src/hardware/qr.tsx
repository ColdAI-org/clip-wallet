/**
 * Camera scanning and animated QR display for Keystone. The camera needs a page that can show the
 * permission prompt (an extension tab or the approval window), not the action popup.
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { AnimatedUr, UrCollector, WrongUrType, startQrScanner, urFromJson, urToJson, type QrScanner, type UrJson } from "@clip-wallet/hardware/qr";
import { userMessageOf } from "../client";
import { ErrorNote, Spinner } from "../components";

export type ScannerStart = typeof startQrScanner;

/** Collects one UR of the expected types from the camera; calls onComplete once. */
export function UrScanner(props: { expect: string[]; onComplete: (ur: UrJson) => void; start?: ScannerStart; label?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  const { onComplete } = props;
  const expectKey = props.expect.join(",");

  useEffect(() => {
    let scanner: QrScanner | undefined;
    let live = true;
    const collector = new UrCollector(expectKey.split(","));
    const start = props.start ?? startQrScanner;
    if (!video.current) return;
    start(video.current, {
      onText(text) {
        if (done.current) return;
        try {
          const p = collector.receive(text);
          setProgress(p.progress);
          if (p.done) {
            done.current = true;
            const ur = urToJson(collector.result());
            scanner?.stop();
            onComplete(ur);
          }
        } catch (e) {
          setErr(e instanceof WrongUrType ? "That's a different QR code. Scan the one your Keystone shows for this step." : userMessageOf(e));
        }
      },
    })
      .then((s) => {
        if (live) scanner = s;
        else s.stop();
      })
      .catch((e: unknown) => setErr(userMessageOf(e)));
    return () => {
      live = false;
      scanner?.stop();
    };
  }, [expectKey, onComplete, props.start]);

  return (
    <div className="clip-stack">
      <video ref={video} className="clip-scan-video" muted playsInline aria-label={props.label ?? "Camera preview"} />
      <div role="progressbar" aria-label="Scanned" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="clip-hint">
        {progress > 0 && progress < 1 ? `Reading… ${Math.round(progress * 100)}%` : "Hold the code steady in front of the camera."}
      </div>
      <ErrorNote message={err} />
    </div>
  );
}

/** Shows a UR as a looping animated QR (a still QR when it fits in one frame). */
export function AnimatedQr(props: { ur: UrJson; label: string; fps?: number; fragment?: number }) {
  const [src, setSrc] = useState<string>();
  const { type, cborHex } = props.ur;
  useEffect(() => {
    const anim = new AnimatedUr(urFromJson({ type, cborHex }), props.fragment ?? 200);
    let live = true;
    const draw = () =>
      QRCode.toString(anim.next(), { type: "svg", margin: 1, errorCorrectionLevel: "L", color: { dark: "#141414", light: "#ffffff" } })
        .then((svg) => live && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
        .catch(() => undefined);
    void draw();
    const timer = anim.animated ? setInterval(() => void draw(), 1000 / (props.fps ?? 5)) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [type, cborHex, props.fps, props.fragment]);
  return <div className="clip-qr">{src ? <img src={src} alt={props.label} width={240} height={240} /> : <Spinner />}</div>;
}
