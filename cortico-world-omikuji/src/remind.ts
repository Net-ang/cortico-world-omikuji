/**
 * 「今天还没抽签」提醒的记账。
 *
 * 只记最后一回提醒的是哪一天：同一天最多提醒一次，换天重置。文件很小
 * （`omikuji-remind.json`），坏了就当没提醒过——提醒是锦上添花，不该因为读不出
 * 这个文件就把 World 挂载搞失败。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REMIND_FILE_NAME = 'omikuji-remind.json';

function remindPath(dataDir: string): string {
  return join(dataDir, REMIND_FILE_NAME);
}

/** 上一次提醒的日期；没有或读不出来就是 null。 */
export function remindedDate(dataDir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(remindPath(dataDir), 'utf8')) as { date?: unknown };
    return typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  } catch {
    return null;
  }
}

/** 记下「这一天提醒过了」。 */
export function markReminded(dataDir: string, date: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(remindPath(dataDir), `${JSON.stringify({ date }, null, 2)}\n`, 'utf8');
  } catch {
    // 写不进去就算了：最坏是同一天提醒两次
  }
}
