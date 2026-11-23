/**
 * 本机盐：这台机器在这份部署上的身份。
 *
 * 同一天要给出同一张签，所以盐必须落盘；换一台机器就是另一个盐，签也随之不同。
 * 盐只放进种子串，不进回执、不进提示词，也不向外报告。
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
