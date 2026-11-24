/**
 * pet 模式落下的措辞：签文与解签都由桌宠写，同一天第一次写下的那份就是那天的签。
 *
 * 按月份分文件，一天一条；返回给模型的永远是文件里那一份，所以同日再取措辞不变。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** dataDir 由 Core 与所有 World 共用，文件名带 World id 与月份。 */
export const WORDING_FILE_PREFIX = 'omikuji-wording-';

/** 签文（verse）与解签（reading）各自的长度上限，挡住把整段对话写进来的情况。 */
export const MAX_WORDING_LENGTH = 200;
export const MAX_READING_LENGTH = 400;

export interface WordingRecord {
  /** 签文：两句，桌宠自己写的。 */
  text: string;
  /** 解签：它自己解的一段话；早期版本没有这个字段。 */
  reading?: string;
  createdAt: string;
}

type WordingMonth = Record<string, WordingRecord>;

export function wordingFilePath(dataDir: string, dateIso: string): string {
  return join(dataDir, `${WORDING_FILE_PREFIX}${dateIso.slice(0, 7)}.json`);
}

/** 整月读出一次；面板要一次看七天，逐天读同一个文件没有意义。 */
export function readWordingMonth(dataDir: string, dateIso: string): WordingMonth {
  try {
    const parsed = JSON.parse(readFileSync(wordingFilePath(dataDir, dateIso), 'utf8')) as WordingMonth;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // 文件不存在或读坏了都当空：读的人不该因为一个坏文件拿不到今天的签。
    return {};
  }
}

export function readWording(dataDir: string, dateIso: string): WordingRecord | null {
  const record = readWordingMonth(dataDir, dateIso)[dateIso];
  return record && typeof record.text === 'string' && record.text.length > 0 ? record : null;
}

function clean(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string') throw new TypeError(`${what} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RangeError(`${what} must not be empty`);
  if ([...trimmed].length > max) throw new RangeError(`${what} is longer than ${max} characters`);
  return trimmed;
}

/**
 * 同一天重复写入时保留第一次的那份：先写下的才算数。
 *
 * `reading` 可以不传（老版本、或桌宠只想给签文）；传了就要过长度检查。
 */
export function saveWording(
  dataDir: string,
  dateIso: string,
  text: string,
  reading: string | undefined,
  nowIso: string,
): { record: WordingRecord; kept: boolean } {
  const existing = readWording(dataDir, dateIso);
  if (existing) return { record: existing, kept: true };

  const verse = clean(text, MAX_WORDING_LENGTH, 'text');
  const gloss = reading === undefined ? undefined : clean(reading, MAX_READING_LENGTH, 'reading');

  const month = readWordingMonth(dataDir, dateIso);
  const record: WordingRecord = { text: verse, ...(gloss ? { reading: gloss } : {}), createdAt: nowIso };
  month[dateIso] = record;

  mkdirSync(dataDir, { recursive: true });
  const target = wordingFilePath(dataDir, dateIso);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(month, null, 2)}\n`, 'utf8');
  renameSync(staging, target);
  return { record, kept: false };
}
