/**
 * 日签的纯逻辑：日期加当天盐算出种子，种子决定分数、签档与全部文案。
 *
 * 这里不读时间、不读文件、不碰 Math.random：同样的 (日期, 盐, 签库) 永远得到同一张签。
 */
import { SplitMix64, seedFromText } from './rng.ts';
import { almanacLine } from './almanac.ts';

export interface SignTier {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly poems: readonly string[];
  readonly glosses: readonly string[];
  /** 详批：一段话，每天从里面挑一段。 */
  readonly readings: readonly string[];
}

export interface SignDomain {
  readonly id: string;
  readonly label: string;
}

export interface DomainStar extends SignDomain {
  /** 1–5 颗星。 */
  readonly stars: number;
}

export interface SignContent {
  readonly schema: number;
  /** 算法标签。它进种子串，改这一段等于换掉所有人的签。 */
  readonly algorithm: string;
  readonly tiers: readonly SignTier[];
  readonly yi: readonly string[];
  readonly ji: readonly string[];
  readonly colors: readonly string[];
  readonly luckyItems: readonly string[];
  readonly directions: readonly string[];
  /** 六项运势在签面上的名字与顺序。 */
  readonly domains: readonly SignDomain[];
  /** 幸运物/色/数字/方位后面那半句建议。 */
  readonly effects: Readonly<Record<'item' | 'color' | 'number' | 'direction', string>>;
  /** 每档一句写作约束，只在 pet 模式下给模型看。 */
  readonly petTones: Readonly<Record<string, string>>;
  /** pet 模式下供模型挑用的意象。 */
  readonly images: readonly string[];
}

export interface DailySign {
  /** `YYYY-MM-DD` */
  readonly date: string;
  /** 日期本身当数字：2026-11-23 → 20261123。 */
  readonly dateSeed: number;
  readonly score: number;
  readonly tierId: string;
  readonly tierLabel: string;
  /** 第几签，1–1000。 */
  readonly lot: number;
  readonly poem: string;
  readonly gloss: string;
  /** 详批：比解语长一段，说清这一签落在哪件事上。 */
  readonly reading: string;
  /** 六项运势的星级，由档位决定基础、按天微调。 */
  readonly stars: readonly DomainStar[];
  readonly yi: string;
  readonly ji: string;
  readonly color: string;
  readonly luckyItem: string;
  readonly luckyNumber: number;
  readonly luckyDirection: string;
  /** 节气与月相那一行。 */
  readonly almanac: string;
  /** pet 模式的写作约束与可用意象；builtin 模式不用。 */
  readonly tone: string;
  readonly images: readonly string[];
}

export const SCORE_MAX = 100;
export const LOT_MAX = 1000;
export const STAR_MAX = 5;

/** 措辞归谁写：`builtin` 用签库成句，`pet` 由桌宠自己写并落盘。 */
export type WordingMode = 'builtin' | 'pet';

export function asWordingMode(raw: unknown): WordingMode {
  return raw === 'pet' ? 'pet' : 'builtin';
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 只认真实存在的 `YYYY-MM-DD`；`2026-02-30` 这类要挡住，否则种子本身没意义。 */
export function isDateIso(value: string): boolean {
  const matched = DATE_PATTERN.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** 种子串：算法标签 + 该日盐 + 日期。盐不同，这一天的签就不同。 */
export function seedOfDate(dateIso: string, salt: string): bigint {
  if (!isDateIso(dateIso)) throw new RangeError(`not a calendar date: ${dateIso}`);
  if (!salt) throw new RangeError('salt must not be empty');
  return seedFromText(`omikuji/v1|${salt}|${dateIso}`);
}

export function dateSeedOf(dateIso: string): number {
  return Number(dateIso.slice(0, 10).replaceAll('-', ''));
}

export function tierForScore(score: number, content: SignContent): SignTier {
  const tier = content.tiers.find((item) => score >= item.min && score <= item.max);
  if (!tier) throw new RangeError(`no tier covers score ${score}`);
  return tier;
}

/** 档位对应的星级基线：上上签 5，大凶 1。 */
export function baseStarsFor(tier: SignTier): number {
  const middle = (tier.min + tier.max) / 2;
  return Math.min(STAR_MAX, Math.max(1, Math.round(1 + middle / 25)));
}

/**
 * 抽这一天。
 *
 * 取数顺序是约定的一部分：分数、签号、签文、解语、幸运色、宜、忌、意象、详批、六项星级、
 * 幸运物、幸运数字、幸运方位，依次从同一条流里取。改动顺序会让已抽过的日期全部变掉。
 */
export function drawSign(dateIso: string, salt: string, content: SignContent): DailySign {
  const rng = new SplitMix64(seedOfDate(dateIso, salt));
  const score = rng.int(SCORE_MAX + 1);
  const lot = rng.int(LOT_MAX) + 1;
  const tier = tierForScore(score, content);
  const poem = rng.pick(tier.poems);
  const gloss = rng.pick(tier.glosses);
  const color = rng.pick(content.colors);
  const yi = rng.pick(content.yi);
  let ji = rng.pick(content.ji);
  for (let guard = 0; ji === yi && guard < 64; guard += 1) {
    ji = rng.pick(content.ji);
  }
  const images = pickDistinct(rng, content.images, 3);
  const reading = rng.pick(tier.readings);

  // 星级：档位定基线，每项再上下浮动一颗，所以同档不同天也会不一样
  const base = baseStarsFor(tier);
  const stars: DomainStar[] = content.domains.map((domain) => ({
    ...domain,
    stars: clampStar(base + rng.pick([-1, 0, 0, 1])),
  }));

  return {
    date: dateIso,
    dateSeed: dateSeedOf(dateIso),
    score,
    tierId: tier.id,
    tierLabel: tier.label,
    lot,
    poem,
    gloss,
    reading,
    stars,
    yi,
    ji,
    color,
    luckyItem: rng.pick(content.luckyItems),
    luckyNumber: rng.int(99) + 1,
    luckyDirection: rng.pick(content.directions),
    almanac: almanacLine(dateIso),
    tone: content.petTones[tier.id] ?? '',
    images,
  };
}

function clampStar(value: number): number {
  return Math.min(STAR_MAX, Math.max(1, value));
}

/** 从池子里取 n 个不同的项；取不满就少给，不无限重抽。 */
function pickDistinct(rng: SplitMix64, pool: readonly string[], n: number): string[] {
  const picked: string[] = [];
  for (let guard = 0; picked.length < n && guard < n * 16; guard += 1) {
    const item = rng.pick(pool);
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

/** 五格星条，例如 `★★★★☆`。 */
export function starBar(stars: number): string {
  const filled = Math.min(STAR_MAX, Math.max(0, Math.round(stars)));
  return '★'.repeat(filled) + '☆'.repeat(STAR_MAX - filled);
}

/** 回执文本。签文与解语本来就是中文，回执不分语言。 */
export function formatSign(sign: DailySign): string {
  const half = Math.ceil(sign.stars.length / 2);
  const rows = Array.from({ length: half }, (_, i) => {
    const left = sign.stars[i]!;
    const right = sign.stars[i + half];
    const cell = (star: DomainStar) => `${star.label} ${starBar(star.stars)}`;
    return right ? `${cell(left)}　${cell(right)}` : cell(left);
  });
  return [
    `精灵日签 · ${sign.date}`,
    `第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分`,
    '',
    sign.almanac,
    '',
    `签文：${sign.poem}`,
    `解语：${sign.gloss}`,
    `详批：${sign.reading}`,
    '',
    ...rows,
    '',
    `宜：${sign.yi}`,
    `忌：${sign.ji}`,
    `幸运　${sign.luckyItem} · ${sign.color} · ${sign.luckyNumber} · ${sign.luckyDirection}`,
  ].join('\n');
}

/** 进系统前缀的一行。每轮都要付这点 token，所以只给结论，细节留给工具。 */
export function formatHint(sign: DailySign, wording: WordingMode = 'builtin'): string {
  const tail = wording === 'pet' ? 'Call omikuji_draw for the brief.' : 'Call omikuji_draw for the verse.';
  return `Today's slip (${sign.date}): No.${sign.lot}, ${sign.tierLabel}, ${sign.score}. ${tail}`;
}

/**
 * pet 模式的回执：只给事实与约束，不给成句。
 *
 * 签文和解签都由它写：星级、宜忌、幸运这些数字照给，句子留给它自己。
 */
export function formatBrief(sign: DailySign): string {
  const stars = sign.stars.map((star) => `${star.label}${star.stars}★`).join('、');
  return [
    `精灵日签 · ${sign.date}`,
    `第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分`,
    '',
    `这一签的签文和解签都由你来写。分数、档位、星级是既成事实，不能改写。`,
    `这一档的分寸：${sign.tone}`,
    `运势：${stars}（1–5 星）`,
    `宜${sign.yi}；忌${sign.ji}；幸运物${sign.luckyItem}，数字 ${sign.luckyNumber}，方位${sign.luckyDirection}`,
    `可用的意象（挑一两个，不用也不必全用）：${sign.images.join('、')}`,
    '签文怎么写：两句，一共 14–18 字；不作断言，不写「必然」「一定会」「注定」；读起来像随口说的话，不像通告。',
    '解签怎么写：两三句、40–120 字，说清这一天该怎么过——落在能做和别做的事上，别复述星级数字，也别把它写成预言。',
    '语气的底线：这一签只当玩笑话，凶档也不许吓人、不许劝人改计划。免责那句话界面上一直摆着，别在每句回话后面再带一遍。',
    '写完调用 omikuji_record，把 text（签文）和 reading（解签）一起交上来——之后同一天再取，返回的就是你写下的那份。',
  ].join('\n');
}
