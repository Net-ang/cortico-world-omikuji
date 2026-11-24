/**
 * 每日真随机盐。
 *
 * 每天第一次需要签的时候，用 `crypto.randomBytes` 生成一个 64 位随机盐、落盘，之后这一天都用它：
 * 所以同一天同一台机器只有一张签，但不同机器、不同日子彼此独立——不再是「日期加一个装好就永不变的
 * 盐」那样固定。
 *
 * 只留七天：每次落盘都顺手删掉七天前的条目。七天以外的日期没有盐了，回落到 `salt.ts` 里那个固定的
 * 本机盐去算（仍然确定，但已经不是当天抽出来的那一张）。
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** dataDir 由 Core 与所有 World 共用，文件名必须带 World id。 */
export const DAYS_FILE_NAME = 'omikuji-days.json';

/** 保留天数（含今天）：今天往前数 7 天。 */
export const RETENTION_DAYS = 7;

export interface DaySalt {
  salt: string;
  createdAt: string;
}

type DayStore = Record<string, DaySalt>;

export function daysFilePath(dataDir: string): string {
  return join(dataDir, DAYS_FILE_NAME);
}

/** `date` 往前 `n` 天（含当天），升序。 */
export function daysBefore(date: string, n: number): string[] {
  const base = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

function readStore(dataDir: string): DayStore {
  try {
    const parsed = JSON.parse(readFileSync(daysFilePath(dataDir), 'utf8')) as DayStore;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // 读不到或读坏了都当空：坏文件不应该让今天的签取不出来。
    return {};
  }
}

function writeStore(dataDir: string, store: DayStore): void {
  mkdirSync(dataDir, { recursive: true });
  const target = daysFilePath(dataDir);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(staging, target);
}

/** 只读：这一天的盐在不在。不会生成、不会写盘。 */
export function readDaySalt(dataDir: string, date: string): string | null {
  const record = readStore(dataDir)[date];
  return typeof record?.salt === 'string' && record.salt.length > 0 ? record.salt : null;
}

/** 七天窗口内的日期（含今天），用于面板那种「一次看七天」的场合。 */
export function storedDays(dataDir: string, today: string): string[] {
  const store = readStore(dataDir);
  return daysBefore(today, RETENTION_DAYS).filter((date) => typeof store[date]?.salt === 'string');
}

/**
 * 取某一天的盐，没有就当场生成并落盘。
 *
 * 每次落盘都裁掉七天前的条目。返回 `created` 说明这次是不是新摇的。
 */
export function materializeDaySalt(
  dataDir: string,
  date: string,
  nowIso: string,
): { salt: string; created: boolean } {
  const store = readStore(dataDir);
  const existing = store[date];
  if (typeof existing?.salt === 'string' && existing.salt.length > 0) {
    return { salt: existing.salt, created: false };
  }

  const kept: DayStore = {};
  for (const windowDate of daysBefore(date, RETENTION_DAYS)) {
    if (typeof store[windowDate]?.salt === 'string') kept[windowDate] = store[windowDate]!;
  }
  const record: DaySalt = { salt: randomBytes(8).toString('hex'), createdAt: nowIso };
  kept[date] = record;
  writeStore(dataDir, kept);
  return { salt: record.salt, created: true };
}

/** 清掉整份每日盐文件；面板或运维用得上。 */
export function clearDaySalts(dataDir: string): void {
  try {
    unlinkSync(daysFilePath(dataDir));
  } catch {
    // 本来就没有
  }
}
