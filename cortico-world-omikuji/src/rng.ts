/**
 * 自带的 64 位随机引擎：SplitMix64。
 *
 * 只有整数运算，输出完全由种子决定，不读时间、不读环境、不碰语言标准库的随机源与分布。
 * 同一份输入在这里永远得到同一串数，前提是本文件的常数不改。
 */
const MASK = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;
const MIX_A = 0xbf58476d1ce4e5b9n;
const MIX_B = 0x94d049bb133111ebn;

const SPAN = 1n << 64n;

export class SplitMix64 {
  #state: bigint;

  constructor(seed: bigint) {
    this.#state = seed & MASK;
  }

  /** 下一个 64 位无符号整数。 */
  next64(): bigint {
    this.#state = (this.#state + GOLDEN) & MASK;
    let z = this.#state;
    z = ((z ^ (z >> 30n)) * MIX_A) & MASK;
    z = ((z ^ (z >> 27n)) * MIX_B) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  }

  /**
   * `[0, maxExclusive)` 的整数。
   *
   * 用拒绝采样而不是取模：取模会让前 `SPAN % maxExclusive` 个值多出现一次，档位边界上看得出来。
   */
  int(maxExclusive: number): number {
    const n = BigInt(Math.trunc(maxExclusive));
    if (n <= 0n) throw new RangeError(`maxExclusive must be positive, got ${maxExclusive}`);
    if (n > SPAN) throw new RangeError(`maxExclusive must fit in 64 bits, got ${maxExclusive}`);
    const limit = SPAN - (SPAN % n);
    for (;;) {
      const r = this.next64();
      if (r < limit) return Number(r % n);
    }
  }

  /** 从数组里取一项，同样走拒绝采样。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty list');
    return items[this.int(items.length)] as T;
  }
}

/**
 * 把一段文本压成一个 64 位种子。
 *
 * 先 FNV-1a 逐字节累积，再交给 SplitMix64 做一次收尾——单用 FNV 的低位相关性太强，
 * 相邻日期（…1122 与 …1123）会长得很像。
 */
export function seedFromText(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = (hash ^ BigInt(byte)) & MASK;
    hash = (hash * 0x100000001b3n) & MASK;
  }
  return new SplitMix64(hash).next64();
}
