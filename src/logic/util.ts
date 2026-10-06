export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

export function formatStamp(day: number, hour: number): string {
  return `D${String(day).padStart(2, "0")} ${formatHour(hour)}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function weightedIndex(next: () => number, weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}
