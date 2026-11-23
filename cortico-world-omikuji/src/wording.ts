/**
 * pet 模式落下的措辞：同一天第一次写下的正文就是那天的签。
 *
 * 按月份分文件，一天一条；返回给模型的永远是文件里那一份，所以同日再取措辞不变。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** dataDir 由 Core 与所有 World 共用，文件名带 World id 与月份。 */
export const WORDING_FILE_PREFIX = 'omikuji-wording-';

/** 一条措辞的长度上限，挡住把整段对话写进来的情况。 */
export const MAX_WORDING_LENGTH = 200;

export interface WordingRecord {
  text: string;
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

function readMonth(dataDir: string, dateIso: string): WordingMonth {
  return readWordingMonth(dataDir, dateIso);
}

export function readWording(dataDir: string, dateIso: string): WordingRecord | null {
  const record = readMonth(dataDir, dateIso)[dateIso];
  return record && typeof record.text === 'string' && record.text.length > 0 ? record : null;
}

/** 同一天重复写入时保留第一次的正文：先写下的那份才算数。 */
export function saveWording(
  dataDir: string,
  dateIso: string,
  text: string,
  nowIso: string,
): { record: WordingRecord; kept: boolean } {
  const existing = readWording(dataDir, dateIso);
  if (existing) return { record: existing, kept: true };

  const trimmed = text.trim();
  if (trimmed.length === 0) throw new RangeError('wording must not be empty');
  if ([...trimmed].length > MAX_WORDING_LENGTH) {
    throw new RangeError(`wording is longer than ${MAX_WORDING_LENGTH} characters`);
  }

  const month = readMonth(dataDir, dateIso);
  const record: WordingRecord = { text: trimmed, createdAt: nowIso };
  month[dateIso] = record;

  mkdirSync(dataDir, { recursive: true });
  const target = wordingFilePath(dataDir, dateIso);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(month, null, 2)}\n`, 'utf8');
  renameSync(staging, target);
  return { record, kept: false };
}
