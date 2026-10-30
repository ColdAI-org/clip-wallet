// The slice of pako that gunzip.ts uses: `Inflate` (push/onData/err/msg/ended). Written for pako 2.2.0, which had no
// bundled types; pako 3.0.2 ships its own (dist/pako.d.ts) with the same members.
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
