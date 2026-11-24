/**
 * 「今日一签」面板的数据面。
 *
 * 面板只读不写：签由 (日期, 盐) 决定，按键不产生新的随机，也不替桌宠写正文。
 */
import { isDateIso, type DailySign, type WordingMode } from './daily.ts';
import { readWordingMonth } from './wording.ts';

/** 本页内的面板 id，`[a-z0-9-]`，不带 World 前缀。 */
export const PANEL_ID = 'now';

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
  yi: string;
  ji: string;
  color: string;
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
  /** pet 模式下这一天已写下的正文；内置模式恒为 null。 */
  written: string | null;
  /** 今天在最前，往前七天。 */
  recent: PanelDay[];
}

export interface PanelDeps {
  mode: WordingMode;
  dataDir: string;
  today: string;
  /** 只读：那天抽过就是当时那张，没抽过按固定本机盐算。 */
  signFor(date: string): DailySign;
  /** 真抽签：那天还没有当日盐就摇一个真随机的并落盘。 */
  drawFor(date: string): DailySign;
}

const toSign = (sign: DailySign): PanelSign => ({
  date: sign.date,
  lot: sign.lot,
  score: sign.score,
  tierId: sign.tierId,
  tierLabel: sign.tierLabel,
  poem: sign.poem,
  gloss: sign.gloss,
  yi: sign.yi,
  ji: sign.ji,
  color: sign.color,
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
  const months = new Map<string, Record<string, { text?: string }>>();
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

  return {
    mode: deps.mode,
    today: deps.today,
    date,
    sign: toSign(deps.signFor(date)),
    written: wordOn(date),
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
 */
export async function panelInvoke(
  deps: PanelDeps,
  panel: string,
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  if (panel !== PANEL_ID) throw new Error(`没有这个面板：${panel}`);

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
