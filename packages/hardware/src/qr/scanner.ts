/**
 * QR scanning from the camera for Keystone. Uses the browser's BarcodeDetector where it exists
 * (Chromium on macOS, ChromeOS, Android) and falls back to jsQR (pure JS) elsewhere, e.g. Chrome on
 * Windows/Linux and Firefox. Needs a page that can show the camera permission prompt: an extension
 * tab or side panel, not the action popup (see docs/phase2/integration/hardware.md).
 */
import jsQR from "jsqr";
import { HardwareErrors } from "../errors.js";

export interface QrScanner {
  /** Which decoder is in use; shown nowhere, useful in tests and bug reports. */
  readonly engine: "barcode-detector" | "jsqr";
  stop(): void;
}

export interface ScanOptions {
  /** Called for every decoded QR text (the same code repeats while it stays in view). */
  onText(text: string): void;
  onError?(e: unknown): void;
  /** Frames per second to try decoding. Default 12. */
  fps?: number;
  /** For tests. */
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  forceEngine?: "barcode-detector" | "jsqr";
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

/** Decodes one RGBA frame with jsQR. Exposed for tests and for platforms without a camera loop. */
export function decodeImageData(data: Uint8ClampedArray, width: number, height: number): string | null {
  const r = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return r ? r.data : null;
}

async function barcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/** Starts the rear camera into `video` and reports decoded QR texts until stop(). */
export async function startQrScanner(video: HTMLVideoElement, opts: ScanOptions): Promise<QrScanner> {
  const media = opts.mediaDevices ?? globalThis.navigator?.mediaDevices;
  if (!media?.getUserMedia) throw HardwareErrors.noCamera();
  let stream: MediaStream;
  try {
    stream = await media.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    throw HardwareErrors.noCamera(e);
  }
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play().catch(() => undefined);

  const detector = opts.forceEngine === "jsqr" ? null : await barcodeDetector();
  const engine: QrScanner["engine"] = detector ? "barcode-detector" : "jsqr";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false;
  let busy = false;
  const interval = 1000 / (opts.fps ?? 12);

  const tick = async () => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    try {
      if (detector) {
        for (const c of await detector.detect(video)) opts.onText(c.rawValue);
      } else if (ctx) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const text = decodeImageData(img.data, w, h);
          if (text) opts.onText(text);
        }
      }
    } catch (e) {
      opts.onError?.(e);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), interval);

  return {
    engine,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}
