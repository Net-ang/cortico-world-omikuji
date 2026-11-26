/**
 * 「逢凶化吉」的记账。
 *
 * 抽到凶签（大凶 / 小凶）时，那一页会有一个小游戏；通关之后把这一天记下来，
 * 主面板就能在凶签后面挂一枚金色小标签。**不限次数、失败了随时重来**——这一整套
 * 就是图一乐，别把它做成压力。
 *
 * 文件 `omikuji-huaji.json`：`{ "2026-11-24": { at: "...", tries: 3 } }`。
 * 同一天只记最成功的那一次（保留第一次通关的时间），更早的条目在写入时裁掉。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HUAJI_FILE_NAME = 'omikuji-huaji.json';

/** 保留多少天的化吉记录。它只是一枚标签，留久了没意义。 */
const RETENTION_DAYS = 60;

/** 哪些档位算「凶签」：只有大凶与小凶。末吉不算。 */
const BAD_TIERS: ReadonlySet<string> = new Set(['daxiong', 'xiaoxiong']);

export interface HuajiRecord {
  /** 第一次通关的时间（带时区偏移的 ISO）。 */
  at: string;
  /** 这一天的通关一共试了几次（含成功那次）。 */
  tries: number;
}

type HuajiStore = Record<string, HuajiRecord>;

/** 这一档是不是凶签。 */
export function isBadTier(tierId: string): boolean {
  return BAD_TIERS.has(tierId);
}

function storePath(dataDir: string): string {
  return join(dataDir, HUAJI_FILE_NAME);
}

function readStore(dataDir: string): HuajiStore {
  try {
    const parsed = JSON.parse(readFileSync(storePath(dataDir), 'utf8')) as HuajiStore;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(dataDir: string, store: HuajiStore): void {
  mkdirSync(dataDir, { recursive: true });
  const target = storePath(dataDir);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(staging, target);
}

/** 这一天通关过没有；返回记录或 null。只读。 */
export function readHuaji(dataDir: string, date: string): HuajiRecord | null {
  const record = readStore(dataDir)[date];
  if (!record || typeof record.at !== 'string') return null;
  return { at: record.at, tries: Number.isInteger(record.tries) ? record.tries : 1 };
}

/**
 * 记下「这一天化吉成功」。
 *
 * 同一天已经有记录就不覆盖（第一次通关的时间更有意义），只把 tries 取小的那个。
 * 顺手裁掉 RETENTION_DAYS 天前的条目。
 */
export function recordHuaji(
  dataDir: string,
  date: string,
  nowIso: string,
  tries = 1,
): { record: HuajiRecord; kept: boolean } {
  const store = readStore(dataDir);
  const existing = store[date];
  if (existing && typeof existing.at === 'string') {
    const merged: HuajiRecord = {
      at: existing.at,
      tries: Math.min(existing.tries ?? tries, tries),
    };
    store[date] = merged;
    writeStore(dataDir, prune(store, date));
    return { record: merged, kept: true };
  }
  const record: HuajiRecord = { at: nowIso, tries: Math.max(1, tries) };
  store[date] = record;
  writeStore(dataDir, prune(store, date));
  return { record, kept: false };
}

/** 裁掉太老的条目：以 `latest` 为准往前 RETENTION_DAYS 天。 */
function prune(store: HuajiStore, latest: string): HuajiStore {
  const cutoff = new Date(`${latest}T00:00:00Z`).getTime() - (RETENTION_DAYS - 1) * 86_400_000;
  const oldest = new Date(cutoff).toISOString().slice(0, 10);
  const kept: HuajiStore = {};
  for (const [date, record] of Object.entries(store)) {
    if (date >= oldest) kept[date] = record;
  }
  return kept;
}
