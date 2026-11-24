/**
 * 固定的本机盐：这台机器在这份部署上的身份，也是「七天以外」的回落种子。
 *
 * 现在的日常盐是每天现摇的真随机（见 `daysalt.ts`）；这个固定盐只在两种场合出场：
 * 七天以前/以后的日期已经没有当日盐了，回落到它去算；以及配置里想两台机器对齐时用它。
 * 它只进种子串，不进回执、不进提示词，也不向外报告。
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** dataDir 由 Core 与所有 World 共用，文件名必须带 World id。 */
export const SALT_FILE_NAME = 'omikuji-salt.json';

interface SaltRecord {
  salt: string;
  createdAt: string;
}

export function saltFilePath(dataDir: string): string {
  return join(dataDir, SALT_FILE_NAME);
}

/** 读已有的盐；文件缺失或格式不对返回 null，坏文件不静默覆盖。 */
export function readSalt(dataDir: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(saltFilePath(dataDir), 'utf8');
  } catch {
    return null;
  }
  try {
    const record = JSON.parse(raw) as Partial<SaltRecord>;
    return typeof record.salt === 'string' && record.salt.length > 0 ? record.salt : null;
  } catch {
    return null;
  }
}

/**
 * 取盐，没有就造一个。
 *
 * 先写临时文件再改名，读的人不会看到写了一半的内容。
 */
export function ensureSalt(dataDir: string, nowIso: string): string {
  const existing = readSalt(dataDir);
  if (existing) return existing;
  mkdirSync(dataDir, { recursive: true });
  const record: SaltRecord = { salt: randomBytes(8).toString('hex'), createdAt: nowIso };
  const target = saltFilePath(dataDir);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(staging, target);
  return record.salt;
}
