export type PuzzleSeed = string | number;

// Deterministic 128-bit PRNG for reproducible puzzle generation. Numeric seeds
// remain accepted so already-issued puzzles and development fixtures still work.
export class XorShift128 {
  private x: number;
  private y: number;
  private z: number;
  private w: number;

  constructor(seed: PuzzleSeed) {
    const hex = typeof seed === "string"
      ? seed.replace(/[^0-9a-f]/gi, "").padStart(32, "0").slice(-32)
      : (seed >>> 0).toString(16).padStart(32, "0");
    this.x = parseInt(hex.slice(0, 8), 16) >>> 0;
    this.y = parseInt(hex.slice(8, 16), 16) >>> 0;
    this.z = parseInt(hex.slice(16, 24), 16) >>> 0;
    this.w = parseInt(hex.slice(24, 32), 16) >>> 0;
    if ((this.x | this.y | this.z | this.w) === 0) this.w = 0x6d2b79f5;
  }

  nextU32(): number {
    const t = (this.x ^ (this.x << 11)) >>> 0;
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return this.w;
  }
  next01(): number {
    return this.nextU32() / 0xffffffff;
  }
}

export function randomPuzzleSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
