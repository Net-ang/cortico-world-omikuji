/**
 * 未来日期一律拒绝。
 *
 * 未来那天还没到，它的真随机盐也还不该存在；一旦允许读，桌宠就会拿「日期 + 固定盐」
 * 算出一张明天的签念给用户——提前剧透，而且那天真抽签时还会换成另一张。
 * 所以入口 `#resolveDate` 统一挡掉，工具/面板/peek/record 谁都绕不过。
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSignContent } from '../src/content.ts';
import { OMIKUJI_DEFAULTS, type OmikujiConfigSection } from '../src/config.ts';
import { daysFilePath, readDaySalt } from '../src/daysalt.ts';
import { OmikujiWorld } from '../src/world.ts';
import { panelInvoke, PANEL_ID, type PanelDeps } from '../src/panel.ts';
import { existsSync, readFileSync } from 'node:fs';

const content = loadSignContent();
const PACKAGE_DIR = join(import.meta.dirname, '..');
const root = join(import.meta.dirname, '..', '.tmp-test', 'future');
const TODAY = '2026-11-24';
const TOMORROW = '2026-11-25';
const NEXT_WEEK = '2026-12-01';

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeWorld(dataDir: string, cfg: Partial<OmikujiConfigSection> = {}): OmikujiWorld {
  return new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: 'feedfacefeedface', wording: 'builtin', ...cfg },
    timezone: 'Asia/Shanghai',
    dataDir,
    packageDir: PACKAGE_DIR,
    content,
    now: () => `${TODAY}T10:00:00+08:00`,
  });
}

test('工具：明天的签抽不出来，也不是「返回一张」而是明确拒绝', async () => {
  const world = makeWorld(freshDir('draw'));
  const draw = world.tools()[0]!;
  for (const date of [TOMORROW, NEXT_WEEK]) {
    await assert.rejects(draw.handler({ date }, {} as never), /还没到|future/);
  }
  // 今天与过去照常
  assert.match((await draw.handler({}, {} as never)) as string, /^精灵日签 · 2026-11-24/m);
  assert.match((await draw.handler({ date: '2026-11-20' }, {} as never)) as string, /^精灵日签 · 2026-11-20/m);
});

test('工具：peek 明天也不给，不能借状态查询漏出签号', async () => {
  const world = makeWorld(freshDir('peek'));
  await assert.rejects(world.tools()[0]!.handler({ peek: true, date: TOMORROW }, {} as never), /还没到/);
});

test('工具：record 不许给未来的日子存签文', async () => {
  const world = makeWorld(freshDir('record'), { wording: 'pet' });
  const record = world.tools()[1]!;
  await assert.rejects(record.handler({ text: '明天的签', date: TOMORROW }, {} as never), /还没到/);
  // 过去与今天可以
  assert.match((await record.handler({ text: '今天的签', date: TODAY }, {} as never)) as string, /已记下|已经记下/);
});

test('世界方法：signFor / drawFor 对未来的日期都拒绝', () => {
  const world = makeWorld(freshDir('methods'));
  assert.throws(() => world.signFor(TOMORROW), /还没到/);
  assert.throws(() => world.drawFor(TOMORROW), /还没到/);
  assert.throws(() => world.signFor(NEXT_WEEK), /还没到/);
  assert.equal(world.signFor(TODAY).date, TODAY);
});

test('未来日期不会在磁盘上留下任何记录', async () => {
  const dir = freshDir('no-write');
  const world = makeWorld(dir);
  await assert.rejects(world.tools()[0]!.handler({ date: TOMORROW }, {} as never));
  assert.equal(readDaySalt(dir, TOMORROW), null, '未来那天不该有盐');
  assert.ok(!existsSync(daysFilePath(dir)) || !readFileSync(daysFilePath(dir), 'utf8').includes(TOMORROW));
});

test('面板：未来日期既不给签，也不会摇盐', async () => {
  const dir = freshDir('panel');
  const world = makeWorld(dir);
  const deps: PanelDeps = {
    mode: 'builtin',
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    today: TODAY,
    signFor: (date) => world.signFor(date),
    drawFor: (date) => world.drawFor(date),
    text: { font: 'kai' },
  };
  await assert.rejects(panelInvoke(deps, PANEL_ID, 'snapshot', [TOMORROW]), /还没到/);
  await assert.rejects(panelInvoke(deps, PANEL_ID, 'draw', [TOMORROW]), /还没到/);
  assert.equal(readDaySalt(dir, TOMORROW), null);
});

test('跨过零点之后，昨天那个「未来」就变成可抽的今天', () => {
  const dir = freshDir('rollover');
  const world = makeWorld(dir);
  assert.throws(() => world.drawFor(TOMORROW), /还没到/);

  // 时钟推到明天
  const nextDay = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: 'feedfacefeedface', wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    content,
    now: () => `${TOMORROW}T10:00:00+08:00`,
  });
  assert.equal(nextDay.drawFor(TOMORROW).date, TOMORROW);
  assert.ok(readDaySalt(dir, TOMORROW), '到了那天才摇盐');
});
