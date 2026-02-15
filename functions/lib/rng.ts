// Simple deterministic PRNG for reproducible puzzle generation.
export class XorShift32 {
  private x: number;
  constructor(seed: number) {
    // avoid zero seed
    this.x = (seed | 0) || 0x6d2b79f5;
  }
  nextU32(): number {
    let x = this.x | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x | 0;
    return (this.x >>> 0) as number;
  }
  next01(): number {
    return this.nextU32() / 0xffffffff;
  }
}

export function randomU32(): number {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return u[0]!;
}

