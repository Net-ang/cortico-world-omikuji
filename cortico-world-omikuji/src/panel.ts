/**
 * 「今日一签」面板的数据面。
 *
 * 面板本身不改状态：签由 (日期, 盐) 决定，抽签走 `draw`，其余都是读。
 * 抽签动画的素材由 `video` 流式送出（`$file`），面板没拿到就退化成直接揭晓。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDateIso, type DailySign, type WordingMode } from './daily.ts';
import { readWordingMonth } from './wording.ts';

/** 本页内的面板 id，`[a-z0-9-]`，不带 World 前缀。 */
export const PANEL_ID = 'now';

/** 抽签动画：包内相对路径。文件不在就退回无动画。 */
export const DRAW_VIDEO = 'assets/draw.mp4';

/** 面板上一次看七天。 */
const RECENT_DAYS = 7;

export interface PanelDay {
  date: string;
  lot: number;
  score: number;
  tierLabel: string;
  /** pet 模式下这一天是否已经有桌宠写下的正文。 */
  written: boolean;
}

export interface PanelSign {
  date: string;
  lot: number;
  score: number;
  tierId: string;
  tierLabel: string;
  poem: string;
  gloss: string;
  /** 详批。 */
  reading: string;
  /** 六项运势的星级。 */
  stars: Array<{ id: string; label: string; stars: number }>;
  yi: string;
  ji: string;
  color: string;
  luckyItem: string;
  luckyNumber: number;
  luckyDirection: string;
  almanac: string;
  /** pet 模式下给模型的写作分寸与可用意象。 */
  tone: string;
  images: string[];
}

export interface PanelSnapshot {
  mode: WordingMode;
  /** 部署时区的今天。 */
  today: string;
  /** 本次是哪一天的签：默认今天，回看时是那一天。 */
  date: string;
  sign: PanelSign;
  /** pet 模式下这一天已写下的签文；内置模式恒为 null。 */
  written: string | null;
  /** pet 模式下它自己写的解签；没写就为 null。 */
  writtenReading: string | null;
  /** 今天在最前，往前七天。 */
  recent: PanelDay[];
}

export interface PanelDeps {
  mode: WordingMode;
  dataDir: string;
  /** 包目录：抽签动画这类静态素材在包内，不在部署数据目录里。 */
  packageDir: string;
  today: string;
  /** 只读：那天抽过就是当时那张，没抽过按固定本机盐算。 */
  signFor(date: string): DailySign;
  /** 真抽签：那天还没有当日盐就摇一个真随机的并落盘。 */
  drawFor(date: string): DailySign;
}

/** 抽签动画的流式回执形状；文件不在时返回 null，面板会直接揭晓。 */
export function drawVideo(deps: PanelDeps): { $file: { mime: string; path: string; bytes: number; sha256: string } } | null {
  const path = join(deps.packageDir, DRAW_VIDEO);
  if (!existsSync(path)) return null;
  const bytes = statSync(path).size;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { $file: { mime: 'video/mp4', path, bytes, sha256 } };
}

const toSign = (sign: DailySign): PanelSign => ({
  date: sign.date,
  lot: sign.lot,
  score: sign.score,
  tierId: sign.tierId,
  tierLabel: sign.tierLabel,
  poem: sign.poem,
  gloss: sign.gloss,
  reading: sign.reading,
  stars: sign.stars.map((star) => ({ id: star.id, label: star.label, stars: star.stars })),
  yi: sign.yi,
  ji: sign.ji,
  color: sign.color,
  luckyItem: sign.luckyItem,
  luckyNumber: sign.luckyNumber,
  luckyDirection: sign.luckyDirection,
  almanac: sign.almanac,
  tone: sign.tone,
  images: [...sign.images],
});

/** 从 `date` 往前 `n` 天，含当天。 */
function daysBack(date: string, n: number): string[] {
  const base = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base - i * 86_400_000).toISOString().slice(0, 10));
}

export function panelSnapshot(deps: PanelDeps, wanted?: string): PanelSnapshot {
  const date = wanted ?? deps.today;
  if (!isDateIso(date)) throw new RangeError(`date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);

  // 七天多半落在同一个月，按月份缓存，避免逐天重读同一个文件。
  const months = new Map<string, Record<string, { text?: string; reading?: string }>>();
  const monthOf = (day: string) => {
    const key = day.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      month = readWordingMonth(deps.dataDir, day);
      months.set(key, month);
    }
    return month;
  };
  const writtenOn = (day: string) => typeof monthOf(day)[day]?.text === 'string';
  const wordOn = (day: string): string | null => {
    const record = monthOf(day)[day];
    return deps.mode === 'pet' && typeof record?.text === 'string' ? record.text : null;
  };
  const readingOn = (day: string): string | null => {
    const record = monthOf(day)[day];
    return deps.mode === 'pet' && typeof record?.reading === 'string' && record.reading.length > 0 ? record.reading : null;
  };

  return {
    mode: deps.mode,
    today: deps.today,
    date,
    sign: toSign(deps.signFor(date)),
    written: wordOn(date),
    writtenReading: readingOn(date),
    recent: daysBack(deps.today, RECENT_DAYS).map((day) => {
      const sign = deps.signFor(day);
      return { date: day, lot: sign.lot, score: sign.score, tierLabel: sign.tierLabel, written: writtenOn(day) };
    }),
  };
}

/**
 * 面板方法入口。
 *
 * `snapshot` 只读：打开面板、看七天横排、回看某一天都不摇盐。
 * `draw` 才是抽签——它会给那一天摇一个真随机的盐并落盘。面板上只有「抽今天的签」按钮走这条路。
 * `video` 把抽签动画的 mp4 流式送出去；文件不在时给 `{ absent: true }`，面板据此直接揭晓。
 */
export async function panelInvoke(
  deps: PanelDeps,
  panel: string,
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  if (panel !== PANEL_ID) throw new Error(`没有这个面板：${panel}`);

  if (method === 'video') {
    const file = drawVideo(deps);
    if (!file) console.info('[omikuji] 没有 assets/draw.mp4，抽签不播动画。');
    return file ?? { absent: true };
  }

  const wanted = args[0];
  if (wanted !== undefined && typeof wanted !== 'string') throw new TypeError('日期必须是字符串');
  if (wanted !== undefined && !isDateIso(wanted)) throw new RangeError(`not a calendar date: ${wanted}`);
  const date = wanted ?? deps.today;

  if (method === 'snapshot') return panelSnapshot(deps, date);
  if (method === 'draw') {
    deps.drawFor(date);
    return panelSnapshot(deps, date);
  }
  throw new Error(`今日一签没有这个方法：${method}`);
}
