/**
 * 发布前检查：跑框架自己的 authorGuide（标签词表 + 版本 + files + 契约提示）。
 *
 *   node --experimental-transform-types tools/release-check.ts           # 全量，含整张标签词表
 *   node --experimental-transform-types tools/release-check.ts --brief   # 只留结论，发布流程里用这个
 *
 * 标签词表要访问索引仓；取不到时如实报「跳过」，不用本地旧词表冒充当前词表。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorGuide, fetchTagIndex } from 'cortico/extensions/author-guide.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const brief = process.argv.includes('--brief');

const index = await fetchTagIndex().catch((err: unknown) => ({ ok: false, reason: String(err) }));
if (index.ok) {
  const names = Object.keys((index as unknown as { index: { tags: Record<string, unknown> } }).index.tags ?? {});
  if (brief) console.log(`市场标签词表：已取到 ${names.length} 个`);
  else console.log(`市场标签词表：取到 ${names.length} 个 → ${names.join(', ')}\n`);
} else {
  console.log(`市场标签词表：取不到（${(index as { reason?: string }).reason ?? 'unknown'}），本次跳过标签核对\n`);
}

const lines = await authorGuide(packageDir, pkg);
// 精简模式去掉逐条标签释义（四空格缩进的那些），只留声明结果与发布前清单。
const shown = brief
  ? lines.filter((line) => !/^ {4}\S/.test(line) && !line.startsWith('Notice and warning tags:'))
  : lines;
for (const line of shown) console.log(line);
