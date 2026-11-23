/**
 * 日签的纯逻辑：日期加本机盐算出种子，种子决定分数、签档与文案。
 *
 * 这里不读时间、不读文件、不碰 Math.random：同样的 (日期, 盐, 签库) 永远得到同一张签。
 */
import { SplitMix64, seedFromText } from './rng.ts';

export interface SignTier {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly poems: readonly string[];
  readonly glosses: readonly string[];
}

export interface SignContent {
  readonly schema: number;
  /** 算法标签。它进种子串，改这一段等于换掉所有人的签。 */
  readonly algorithm: string;
  readonly tiers: readonly SignTier[];
  readonly yi: readonly string[];
  readonly ji: readonly string[];
  readonly colors: readonly string[];
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
  readonly yi: string;
  readonly ji: string;
  readonly color: string;
  /** pet 模式的写作约束与可用意象；builtin 模式不用。 */
  readonly tone: string;
  readonly images: readonly string[];
}

export const SCORE_MAX = 100;
export const LOT_MAX = 1000;

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

/** 种子串：算法标签 + 本机盐 + 日期。盐不同，同一天的签就不同。 */
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

/**
 * 抽今天的签。
 *
 * 取数顺序是约定的一部分：分数、签号、签文、解语、幸运色、宜、忌依次从同一条流里取，
 * 改动顺序会让历史日期的签全部变掉。
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
  return {
    date: dateIso,
    dateSeed: dateSeedOf(dateIso),
    score,
    tierId: tier.id,
    tierLabel: tier.label,
    lot,
    poem,
    gloss,
    yi,
    ji,
    color,
    tone: content.petTones[tier.id] ?? '',
    images: pickDistinct(rng, content.images, 3),
  };
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

/**
 * 回执文本。签文与解语本来就是中文，回执不分语言。
 *
 * 不带免责声明：那是界面上一直摆着的一句话，塞进每次回执只会变成噪音。
 */
export function formatSign(sign: DailySign): string {
  return [
    `精灵日签 · ${sign.date}`,
    `第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分`,
    '',
    `签文：${sign.poem}`,
    `解语：${sign.gloss}`,
    `宜：${sign.yi}`,
    `忌：${sign.ji}`,
    `幸运色：${sign.color}`,
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
 * 字数、句式、不断言、凶档不吓人这几条都在这里说清楚，口吻留给 Persona。
 */
export function formatBrief(sign: DailySign): string {
  return [
    `精灵日签 · ${sign.date}`,
    `第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分`,
    '',
    '这一签的措辞由你来写，分数和档位不能用别的话替换或改写。',
    `这一档的分寸：${sign.tone}`,
    `可用的意象（挑一两个，不用也不必全用）：${sign.images.join('、')}`,
    '写法：两句，一共 14–18 字；不作断言，不写「必然」「一定会」「注定」；读起来像随口说的话，不像通告。',
    '语气的底线：这一签只当玩笑话，凶档也不许吓人、不许劝人改计划。免责那句话界面上一直摆着，别在每句回话后面再带一遍。',
    '写完调用 omikuji_record，把你这一签的正文交上来——之后同一天再取，返回的就是你写下的那一份。',
  ].join('\n');
}
