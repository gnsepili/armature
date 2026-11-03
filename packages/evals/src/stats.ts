/** Small, dependency-free statistics: seeded RNG, bootstrap intervals, Fisher's exact test. */

/** mulberry32: a fast seeded PRNG, so intervals are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export const MIN_BOOTSTRAP_N = 10;

/** 95% percentile bootstrap interval of the mean; null when the sample is too small. */
export function bootstrapCi(values: number[], seed = 1, resamples = 2000): [number, number] | null {
  if (values.length < MIN_BOOTSTRAP_N) return null;
  const rand = rng(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rand() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

/** Paired bootstrap of mean(b - a) over matched items. */
export function pairedBootstrapCi(
  a: number[],
  b: number[],
  seed = 1,
  resamples = 2000,
): [number, number] | null {
  const diffs = a.map((x, i) => b[i]! - x);
  return bootstrapCi(diffs, seed, resamples);
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/**
 * Two-sided Fisher exact test on a 2x2 table:
 *   a = passes in A, b = failures in A, c = passes in B, d = failures in B.
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = row1 + row2;
  const lf = (k: number) => logFactorial(k);
  const base = lf(row1) + lf(row2) + lf(col1) + lf(n - col1) - lf(n);
  const prob = (x: number) => Math.exp(base - lf(x) - lf(row1 - x) - lf(col1 - x) - lf(row2 - col1 + x));
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, col1 - row2); x <= Math.min(row1, col1); x++) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-9)) p += px;
  }
  return Math.min(1, p);
}

/** Unbiased pass@k estimate from n trials with c passes (Chen et al. 2021). */
export function passAtK(n: number, c: number, k: number): number {
  if (n - c < k) return 1;
  let prod = 1;
  for (let i = n - c + 1; i <= n; i++) prod *= 1 - k / i;
  return 1 - prod;
}

/** pass^k estimate: the chance that k trials drawn without replacement all pass. */
export function passPowK(n: number, c: number, k: number): number {
  if (k > n) return Number.NaN;
  let prod = 1;
  for (let i = 0; i < k; i++) prod *= (c - i) / (n - i);
  return Math.max(0, prod);
}
