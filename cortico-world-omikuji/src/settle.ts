/**
 * 每日结算记账：记「今天这一天的结算已经做过了」。
 *
 * 结算 = 每天早上 7 点（部署时区）把昨天定下来：昨天抽过就是当时那张；没抽过就用
 * 「日期 + 固定本机盐」补录并冻结。同一天只结算一次；跨零点自动重置。
 *
 * 文件 `omikuji-settle.json` 很小，坏了就当没结算过（最多重复结算一次，结果一样）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SETTLE_FILE_NAME = 'omikuji-settle.json';

/** 上一次结算记在哪一天；读不出来就是 null。 */
export function settledDate(dataDir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, SETTLE_FILE_NAME), 'utf8')) as { date?: unknown };
    return typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  } catch {
    return null;
  }
}

/** 记下「这一天的结算做完了」。 */
export function markSettled(dataDir: string, date: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, SETTLE_FILE_NAME), `${JSON.stringify({ date }, null, 2)}\n`, 'utf8');
  } catch {
    // 写不进去就算了：最坏是同一批里再结算一次，结果一样
  }
}
