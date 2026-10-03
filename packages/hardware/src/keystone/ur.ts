/**
 * Uniform Resources (BCR-2020-005) over QR: an animated sender (fountain-coded parts, shown in a loop)
 * and a collector that accepts parts in any order until the message is complete.
 * Library: @ngraveio/bc-ur (the encoder/decoder Keystone's SDK uses).
 */
import { UR, URDecoder, UREncoder } from "@ngraveio/bc-ur";

export { UR };

/** Characters per QR frame. 200 keeps codes readable by Keystone's camera at popup size. */
export const DEFAULT_FRAGMENT = 200;

export class AnimatedUr {
  private readonly encoder: UREncoder;
  constructor(
    readonly ur: UR,
    maxFragmentLength = DEFAULT_FRAGMENT,
  ) {
    this.encoder = new UREncoder(ur, maxFragmentLength, 0);
  }
  /** Number of distinct pure parts; > 1 means the QR animates. */
  get parts(): number {
    return this.encoder.fragmentsLength;
  }
  get animated(): boolean {
    return this.parts > 1;
  }
  /** The next frame (upper-cased so QR uses the compact alphanumeric mode). Loops forever with fountain parts. */
  next(): string {
    return this.encoder.nextPart().toUpperCase();
  }
}

export interface ScanProgress {
  /** 0..1 */
  progress: number;
  done: boolean;
}

export class UrCollector {
  private decoder = new URDecoder();
  constructor(private readonly expect?: readonly string[]) {}

  /** Feed one scanned QR text. Non-UR text is ignored (cameras see other codes). */
  receive(text: string): ScanProgress {
    const t = text.trim();
    if (!/^ur:/i.test(t)) return this.progress();
    if (this.expect) {
      const type = t.slice(3).split("/")[0]!.toLowerCase();
      if (!this.expect.includes(type)) throw new WrongUrType(type, this.expect);
    }
    this.decoder.receivePart(t.toLowerCase());
    return this.progress();
  }

  progress(): ScanProgress {
    const done = Boolean(this.decoder.isComplete());
    return { progress: done ? 1 : this.decoder.estimatedPercentComplete(), done };
  }

  result(): UR {
    if (!this.decoder.isComplete()) throw new Error("UR not complete");
    if (!this.decoder.isSuccess()) {
      const err = this.decoder.resultError();
      this.decoder = new URDecoder();
      throw new Error(`UR decode failed: ${err}`);
    }
    return this.decoder.resultUR();
  }
}

export class WrongUrType extends Error {
  constructor(
    readonly got: string,
    readonly expected: readonly string[],
  ) {
    super(`expected ${expected.join(" or ")}, got ${got}`);
  }
}

/** Single-frame convenience (tests, small payloads). */
export const decodeSingle = (text: string): UR => URDecoder.decode(text.toLowerCase());

/** For crossing the extension's message bus: a UR as { type, cborHex }. */
export interface UrJson {
  type: string;
  cborHex: string;
}
export const urToJson = (ur: UR): UrJson => ({ type: ur.type, cborHex: Buffer.from(ur.cbor).toString("hex") });
export const urFromJson = (j: UrJson): UR => new UR(Buffer.from(j.cborHex, "hex"), j.type);
