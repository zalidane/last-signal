export interface Rng {
  next(): number;
  getState(): number;
  setState(n: number): void;
}

/** Mulberry32. Same seed, same run. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState: () => a >>> 0,
    setState(n: number) {
      a = n >>> 0;
    },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7ffffffe) + 1;
}
