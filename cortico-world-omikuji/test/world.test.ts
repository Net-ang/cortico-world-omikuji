import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { WorldHost } from 'cortico/core/types.ts';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import { OMIKUJI_DEFAULTS, type OmikujiConfigSection } from '../src/config.ts';
import { readDaySalt } from '../src/daysalt.ts';
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
void fakeHost;

test('peek 只问状态不摇盐：没抽过就说没抽，且半个分数都不给', async () => {
  const dir = join(import.meta.dirname, '..', '.tmp-test', 'world-peek');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const world = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: 'feedfacefeedface', wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    content,
  });
  const peek = (await world.tools()[0]!.handler({ peek: true }, {} as never)) as string;
  assert.match(peek, /还没抽签/);
  assert.doesNotMatch(peek, /\d+ ?分/, 'peek 不许把「现在抽会是什么」当成结论');
  assert.equal(readDaySalt(dir, world.signFor().date), null, 'peek 不能落盐');

  // 真抽一次之后，peek 才报得出一张定下来的签
  const drawn = world.drawFor();
  const after = (await world.tools()[0]!.handler({ peek: true }, {} as never)) as string;
  assert.match(after, new RegExp(`第 ${drawn.lot} 签`));
  assert.match(after, new RegExp(`${drawn.score} 分`));
});

test('peek 对过去没抽过的日期给稳定结论（那天当时没抽，不会变）', async () => {
  const world = makeWorld({ salt: 'feedfacefeedface' });
  const note = (await world.tools()[0]!.handler({ peek: true, date: '2020-01-01' }, {} as never)) as string;
  assert.match(note, /没有抽过签/);
  assert.match(note, /不会再变/);
});

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

test('环境段是静态的：不含分数，抽签前后一字不变', async () => {
  const world = makeWorld({ salt: 'feedfacefeedface' });
  const before = world.envPromptVars();
  assert.ok(before, 'hint must not be omitted');
  const hint = before['omikuji.hint']!;
  assert.doesNotMatch(hint, /\d+ ?分/, '前缀里不能有分数：它不会随抽签刷新');
  assert.match(hint, /omikuji_draw/);

  // 抽一次签，前缀必须原样——否则模型上下文里会同时存在「前缀说 A」和「回执说 B」
  await world.tools()[0]!.handler({}, {} as never);
  assert.deepEqual(world.envPromptVars(), before);
});

test('挂载事件走 piggyback；今天没抽过时一个字都不提分数', async () => {
  const dir = join(import.meta.dirname, '..', '.tmp-test', 'world-started-undrawn');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const world = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: 'feedfacefeedface', wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    content,
  });
  const pushed: Array<{ event: { type: string; text: string; origin: string }; opts: unknown }> = [];
  const host = {
    pushEvent: async (event: unknown, opts?: unknown) => {
      pushed.push({ event: event as { type: string; text: string; origin: string }, opts });
      return event;
    },
  } as unknown as WorldHost;

  await world.start(host);
  try {
    const started = pushed.find((item) => item.event.type === 'omikuji.started');
    assert.ok(started, 'mount must push omikuji.started');
    assert.equal(started.event.origin, 'internal');
    assert.deepEqual(started.opts, { trigger: 'piggyback' }, '内部事件默认 flush 会每轮白跑一次');
    assert.match(started.event.text, /还没抽签/);
    assert.doesNotMatch(started.event.text, /\d+ ?分/, '没抽的时候报分数，抽完就会自相矛盾');

    // 抽签之后分数才定下来，这时才允许出现在事件里
    const drawn = world.drawFor();
    assert.doesNotMatch(world.envPromptVars()!['omikuji.hint']!, /\d+ ?分/);
    assert.ok(drawn.score >= 0);
  } finally {
    await world.stop();
  }

  // stop 之后定时器不能继续推事件
  const count = pushed.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pushed.length, count);
});

test('不填盐时落盘一个，之后同一台机器沿用', async () => {
  rmSync(dataDir, { recursive: true, force: true });
  const first = makeWorld().signFor('2026-11-23');
  const second = makeWorld().signFor('2026-11-23');
  assert.deepEqual(second, first, 'a second mount must reuse the stored salt');
});
