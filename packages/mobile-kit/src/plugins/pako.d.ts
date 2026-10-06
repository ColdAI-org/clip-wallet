// The slice of pako 2.2.0 (no bundled types) that gunzip.ts uses: lib/inflate.js `Inflate` (push/onData/err/msg).
declare module "pako" {
  export class Inflate {
    constructor(options?: { windowBits?: number });
    push(data: Uint8Array, flush?: boolean | number): boolean;
    onData(chunk: Uint8Array): void;
    err: number;
    msg: string;
    ended: boolean;
  }
}
