/**
 * 人工对照用：打印一段日期的签。
 *
 *   node tools/preview.ts                          # 今天，桌宠自己写模式下模型会拿到什么
 *   node tools/preview.ts 2026-11-23               # 指定日期
 *   node tools/preview.ts 2026-11-01 10            # 从 11-01 起连续 10 天
 *   node tools/preview.ts 2026-11-23 --salt=abc    # 换一个盐
 *   node tools/preview.ts 2026-11-23 --builtin     # 内置文案模式下的成句回执
 */
import { loadSignContent } from '../src/content.ts';
import { drawSign, formatBrief, formatSign, isDateIso, SCORE_MAX } from '../src/daily.ts';

const args = process.argv.slice(2);
const saltFlag = args.find((arg) => arg.startsWith('--salt='));
const salt = saltFlag ? saltFlag.slice('--salt='.length) : 'preview0salt0000';
// 默认跟着 OMIKUJI_DEFAULTS 走：现在是 pet。要看内置文案加 --builtin。
const builtin = args.includes('--builtin');
const rest = args.filter((arg) => !arg.startsWith('--'));

const content = loadSignContent();
const start = rest[0] ?? new Date().toISOString().slice(0, 10);
if (!isDateIso(start)) throw new Error(`not a calendar date: ${start}`);
const days = Number(rest[1] ?? 1);

const base = new Date(`${start}T00:00:00Z`).getTime();
for (let i = 0; i < days; i += 1) {
  const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
  const sign = drawSign(date, salt, content);
  console.log(builtin ? formatSign(sign) : formatBrief(sign));
  const filled = Math.round((sign.score / SCORE_MAX) * 20);
  console.log(`      [${'#'.repeat(filled)}${'.'.repeat(20 - filled)}]`);
  console.log('');
}
