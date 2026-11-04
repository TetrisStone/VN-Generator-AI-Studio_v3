// Seedable deterministic RNG (mulberry32). The state is a plain number so it
// can live inside the (serialisable) BattleState.

export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** Float in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
