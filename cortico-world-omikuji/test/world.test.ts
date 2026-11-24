import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { WorldHost } from 'cortico/core/types.ts';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import { OMIKUJI_DEFAULTS, type OmikujiConfigSection } from '../src/config.ts';
import { OmikujiWorld } from '../src/world.ts';

const content = loadSignContent();
const PACKAGE_DIR = join(import.meta.dirname, '..');
const dataDir = join(import.meta.dirname, '..', '.tmp-test', 'world');

function makeWorld(cfg: Partial<OmikujiConfigSection> = {}): OmikujiWorld {
  mkdirSync(dataDir, { recursive: true });
  return new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: '', wording: 'builtin', ...cfg },
    timezone: 'Asia/Shanghai',
    dataDir,
    packageDir: PACKAGE_DIR,
    content,
  });
}

function fakeHost(pushed: unknown[]): WorldHost {
  return {
    pushEvent: async (event: unknown) => {
      pushed.push(event);
      return event;
    },
  } as unknown as WorldHost;
}

test('工具回执就是那张签，且带日期参数时按日期算', async () => {
  const world = makeWorld({ salt: 'feedfacefeedface' });
  const tool = world.tools()[0]!;
  const receipt = await tool.handler({ date: '2026-11-23' }, {} as never);
  assert.equal(typeof receipt, 'string');
  const expected = drawSign('2026-11-23', 'feedfacefeedface', content);
  assert.match(receipt as string, new RegExp(`精灵日签 · 2026-11-23`));
  assert.match(receipt as string, new RegExp(`第 ${expected.lot} 签 · ${expected.tierLabel} · ${expected.score} 分`));
  assert.match(receipt as string, new RegExp(expected.poem));
  // 免责声明只出现在界面（面板牌面），回执里不带——不然每次说话都要重复一遍。
  assert.ok(!(receipt as string).includes('相信科学'), 'the receipt must not carry the disclaimer');
  // 回执现在比过去厚：节气月相、详批、六项星级、幸运四项并成一行
  assert.match(receipt as string, /月相·/, 'almanac line');
  assert.match(receipt as string, /详批：/);
  assert.match(receipt as string, /恋爱运 ★{1,5}☆{0,4}/);
  assert.match(receipt as string, /幸运　\S+ · \S+ · \d{1,2} · [东南西北]{1,2}$/m);

  const again = await tool.handler({ date: '2026-11-23' }, {} as never);
  assert.equal(again, receipt, 'same date must give the same receipt');
});

test('不传日期就是今天，非法日期直接报错', async () => {
  const world = makeWorld({ salt: 'feedfacefeedface' });
  const tool = world.tools()[0]!;
  const today = await tool.handler({}, {} as never);
  assert.match(today as string, /^精灵日签 · \d{4}-\d{2}-\d{2}/);
  await assert.rejects(tool.handler({ date: '2026-02-30' }, {} as never), RangeError);
  await assert.rejects(tool.handler({ date: 20261123 }, {} as never), TypeError);
});

test('环境变量只给一行提示，且与工具说的是同一张签', () => {
  const world = makeWorld({ salt: 'feedfacefeedface' });
  const vars = world.envPromptVars();
  assert.ok(vars, 'hint must not be omitted while the sign library is readable');
  const hint = vars['omikuji.hint']!;
  const sign = world.signFor();
  assert.match(hint, new RegExp(`No\\.${sign.lot}, ${sign.tierLabel}, ${sign.score}\\.`));
});

test('挂载时推一条事件，报今天的档位', async () => {
  const world = makeWorld({ salt: 'feedfacefeedface' });
  const pushed: Array<{ type: string; text: string; origin: string }> = [];
  await world.start(fakeHost(pushed));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]!.type, 'omikuji.started');
  assert.equal(pushed[0]!.origin, 'internal');
  assert.match(pushed[0]!.text, new RegExp(world.signFor().tierLabel));
});

test('不填盐时落盘一个，之后同一台机器沿用', async () => {
  rmSync(dataDir, { recursive: true, force: true });
  const first = makeWorld().signFor('2026-11-23');
  const second = makeWorld().signFor('2026-11-23');
  assert.deepEqual(second, first, 'a second mount must reuse the stored salt');
});
