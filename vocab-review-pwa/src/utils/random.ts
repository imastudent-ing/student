export type Rng = () => number;

/** テストで再現可能にするためのシード付き乱数生成器 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** min 以上 max 以下の整数 */
export function randomInteger(min: number, max: number, rng: Rng = Math.random): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Fisher–Yates シャッフル（非破壊） */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 重み付き非復元抽出。weight が大きいほど選ばれやすい。
 */
export function weightedSample<T>(
  items: readonly T[],
  weightFn: (item: T) => number,
  count: number,
  rng: Rng = Math.random
): T[] {
  const pool = items.map((item) => ({ item, weight: Math.max(weightFn(item), 0.0001) }));
  const selected: T[] = [];
  while (selected.length < count && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        index = i;
        break;
      }
    }
    selected.push(pool[index].item);
    pool.splice(index, 1);
  }
  return selected;
}
