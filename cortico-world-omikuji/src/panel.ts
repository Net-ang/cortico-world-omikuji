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
import { readDayRecord } from './daysalt.ts';
import { readWordingMonth } from './wording.ts';

/** 本页内的面板 id，`[a-z0-9-]`，不带 World 前缀。 */
export const PANEL_ID = 'now';

/** 视频主名（不带扩展名）；实际文件可以是 .mp4 / .webm / .mov。 */
const DRAW_BASE = 'assets/draw';
const PANEL_BG_BASE = 'assets/panel-bg';

/** 抽签动画：包内相对路径。 */
export const DRAW_VIDEO = `${DRAW_BASE}.mp4`;

/** 面板的动态背景：包内相对路径。 */
export const PANEL_BG = `${PANEL_BG_BASE}.mp4`;

/** 认这几种视频容器，按扩展名给 Content-Type。 */
const VIDEO_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/** 作者头像：优先 `assets/avatar.*`，没有就用包图标 `assets/icon.*`。 */
const AVATAR_BASES = ['assets/avatar', 'assets/icon'] as const;

/** 头像与动图背景认这几种位图/矢量。 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** 按扩展名顺序找一个存在的视频；返回包内相对路径与 mime。 */
function resolveVideo(deps: PanelDeps, base: string): { rel: string; mime: string } | null {
  for (const [ext, mime] of Object.entries(VIDEO_TYPES)) {
    const rel = `${base}${ext}`;
    if (existsSync(join(deps.packageDir, rel))) return { rel, mime };
  }
  return null;
}

/** 头像的文件路径与 mime：先找 avatar.*，再退到 icon.*。 */
function avatarFile(deps: PanelDeps): { path: string; mime: string } | null {
  for (const base of AVATAR_BASES) {
    for (const [ext, mime] of Object.entries(IMAGE_TYPES)) {
      const path = join(deps.packageDir, `${base}${ext}`);
      if (existsSync(path)) return { path, mime };
    }
  }
  return null;
}

/** 头像有没有可用素材（只查存在，不读内容）。 */
export function hasAvatar(deps: PanelDeps): boolean {
  return avatarFile(deps) !== null;
}

/** 作者头像的流式回执；没有素材就返回 null。 */
export function panelAvatar(deps: PanelDeps): { $file: { mime: string; path: string; bytes: number; sha256: string } } | null {
  const found = avatarFile(deps);
  if (!found) return null;
  const bytes = statSync(found.path).size;
  const sha256 = createHash('sha256').update(readFileSync(found.path)).digest('hex');
  return { $file: { mime: found.mime, path: found.path, bytes, sha256 } };
}

/** 面板上一次看七天。 */
const RECENT_DAYS = 7;

export interface PanelDay {
  date: string;
  /** 有记录就是定下来的（当天抽的，或第二天用固定盐补录的）。 */
  drawn: boolean;
  /** 这一天是补录的（没抽，按固定盐定下来）：签已经冻结，可以放心显示。 */
  locked: boolean;
  /** 没定的日子这里是 null——不抽就不给任何数字。 */
  lot: number | null;
  score: number | null;
  tierLabel: string | null;
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
  /**
   * 这一天的签；**没定下来就是 null**。
   *
   * 「没定下来」= 就是今天、而且今天还没抽过。那种情况下按固定盐算出来的那张只是
   * 「现在抽会是什么」，真抽一次会摇新盐换成另一张，所以一个数字都不给。
   * 七天里的格子同理（`recent` 里没定的那格全是 null）。
   */
  sign: PanelSign | null;
  /** pet 模式下这一天已写下的签文；内置模式恒为 null。 */
  written: string | null;
  /** pet 模式下它自己写的解签；没写就为 null。 */
  writtenReading: string | null;
  /** 包里有 `assets/panel-bg.*` 时为 true，面板会去取它当动态背景。 */
  background: boolean;
  /** 面板字体。 */
  text: PanelText;
  /** 有没有作者头像素材。 */
  avatar: boolean;
  /** 今天这一天定下来没有（抽过，或已经被补录）。 */
  drawn: boolean;
  /** 今天是不是补录的（没抽，用固定盐定下）。 */
  locked: boolean;
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
  /** 面板字体。 */
  text: PanelText;
}

/** 面板的字体选择；字号与字重由 CSS 定，不随配置走。 */
export interface PanelText {
  font: string;
}

/** 有没有这个视频文件。只查存在，不读内容——快照里每轮都要问一次。 */
function hasVideo(deps: PanelDeps, base: string): boolean {
  return resolveVideo(deps, base) !== null;
}

/**
 * 包内静态文件的 sha256 缓存。
 *
 * 背景那个 mp4 有 16 MB，而面板每次开、每次重放动画都会来要一次 `$file`；
 * 每次都同步读一遍整块文件再算哈希，等于在主线程上做 16 MB 的无用功。
 * 用 mtime + size 作键：文件没换就复用，换了（或大小变了）就重算。
 */
const fileDigests = new Map<string, { mtimeMs: number; size: number; sha256: string }>();

/** 一个包内文件的大小与 sha256；同一个文件没改动时不再重读。 */
function fileFacts(path: string): { bytes: number; sha256: string } {
  const stat = statSync(path);
  const cached = fileDigests.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { bytes: cached.size, sha256: cached.sha256 };
  }
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  fileDigests.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, sha256 });
  return { bytes: stat.size, sha256 };
}

/** 把一个包内视频做成流式回执；文件不在就返回 null。 */
function videoFile(deps: PanelDeps, base: string): { $file: { mime: string; path: string; bytes: number; sha256: string } } | null {
  const found = resolveVideo(deps, base);
  if (!found) return null;
  const path = join(deps.packageDir, found.rel);
  return { $file: { mime: found.mime, path, ...fileFacts(path) } };
}

/** 抽签动画的流式回执形状；文件不在时返回 null，面板会直接揭晓。 */
export function drawVideo(deps: PanelDeps): { $file: { mime: string; path: string; bytes: number; sha256: string } } | null {
  return videoFile(deps, DRAW_BASE);
}

/** 背景可以是视频，也可以是动图/静图（GIF 自己会循环）。 */
function backgroundFile(deps: PanelDeps): { path: string; mime: string } | null {
  const video = resolveVideo(deps, PANEL_BG_BASE);
  if (video) return { path: join(deps.packageDir, video.rel), mime: video.mime };
  for (const [ext, mime] of Object.entries(IMAGE_TYPES)) {
    const path = join(deps.packageDir, `${PANEL_BG_BASE}${ext}`);
    if (existsSync(path)) return { path, mime };
  }
  return null;
}

/** 面板动态背景的流式回执；没有素材就没有背景。 */
export function panelBackground(deps: PanelDeps): { $file: { mime: string; path: string; bytes: number; sha256: string } } | null {
  const found = backgroundFile(deps);
  if (!found) return null;
  const bytes = statSync(found.path).size;
  const sha256 = createHash('sha256').update(readFileSync(found.path)).digest('hex');
  return { $file: { mime: found.mime, path: found.path, bytes, sha256 } };
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

  /** 这一天的记录：抽的或补录的；没有就是 null。 */
  const recordOn = (day: string) => readDayRecord(deps.dataDir, day);
  /**
   * 这一天定下来没有。
   *
   * 两种算定下：有记录（当天抽的，或第二天用固定盐补录的），**或者已经是过去的日子**——
   * 过去的日子不会再有随机盐（`drawFor` 只给今天摇盐），所以按固定盐算出来的那张永远不变，
   * 可以放心显示。唯一「没定下来」的就是今天还没抽。那种情况一个数字都不给。
   */
  const settled = (day: string) => recordOn(day) !== null || day < deps.today;

  return {
    mode: deps.mode,
    today: deps.today,
    date,
    // 没定下来就一个数字都不给：签字段整个置空，客户端据此画扣着的牌
    sign: settled(date) ? toSign(deps.signFor(date)) : null,
    written: wordOn(date),
    writtenReading: readingOn(date),
    /** 有没有动态背景素材，面板据此决定要不要去取（这里只查存在，不哈希）。 */
    background: backgroundFile(deps) !== null,
    /** 排版设置：字体（字号与字重由 CSS 定）。 */
    text: { ...deps.text },
    /** 有没有作者头像素材。 */
    avatar: hasAvatar(deps),
    /** 今天定下来没有（抽过，或已被补录）。 */
    drawn: settled(deps.today),
    /** 今天是不是补录的。 */
    locked: recordOn(deps.today)?.source === 'fallback',
    recent: daysBack(deps.today, RECENT_DAYS).map((day) => {
      const locked = settled(day);
      const sign = locked ? deps.signFor(day) : null;
      return {
        date: day,
        drawn: locked,
        locked: recordOn(day)?.source === 'fallback',
        lot: sign ? sign.lot : null,
        score: sign ? sign.score : null,
        tierLabel: sign ? sign.tierLabel : null,
        written: writtenOn(day),
      };
    }),
  };
}

/** 缺素材的提醒只报一次：面板每轮快照都会问 video，刷屏会把日志埋掉。 */
let missingDrawVideoReported = false;

/**
 * 面板方法入口。
 *
 * `snapshot` 只读：打开面板、看七天横排、回看某一天都不摇盐。
 * `draw` 才是抽签——它会给那一天摇一个真随机的盐并落盘。面板上只有「抽今天的签」按钮走这条路。
 * `video` 把抽签动画的 mp4 流式送出去；`background` 送面板的动态背景。两者文件不在时都回
 * `{ absent: true }`，面板据此跳过。
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
    if (!file && !missingDrawVideoReported) {
      missingDrawVideoReported = true;
      console.info(`[omikuji] 没找到 ${DRAW_VIDEO}（包目录 ${deps.packageDir}），抽签不播动画。`);
    }
    return file ?? { absent: true };
  }
  if (method === 'background') {
    const file = panelBackground(deps);
    return file ?? { absent: true };
  }
  if (method === 'avatar') {
    return panelAvatar(deps) ?? { absent: true };
  }

  const wanted = args[0];
  if (wanted !== undefined && typeof wanted !== 'string') throw new TypeError('日期必须是字符串');
  if (wanted !== undefined && !isDateIso(wanted)) throw new RangeError(`not a calendar date: ${wanted}`);
  const date = wanted ?? deps.today;
  // 未来的日子还没有签：面板同样不给看、也不给抽
  if (date > deps.today) {
    throw new RangeError(`${date} 还没到，不能看也不能抽（今天是 ${deps.today}）。`);
  }

  if (method === 'snapshot') return panelSnapshot(deps, date);
  if (method === 'draw') {
    deps.drawFor(date);
    return panelSnapshot(deps, date);
  }
  throw new Error(`今日一签没有这个方法：${method}`);
}
