import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const PACKAGE_DIR = join(import.meta.dirname, '..');
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import type { OmikujiConfigSection } from '../src/config.ts';
import { OMIKUJI_DEFAULTS } from '../src/config.ts';
import { OmikujiWorld } from '../src/world.ts';
import { wordingFilePath } from '../src/wording.ts';

const content = loadSignContent();
const root = join(import.meta.dirname, '..', '.tmp-test', 'wording');
const SALT = 'feedfacefeedface';

function makeWorld(wording: 'builtin' | 'pet', dataDir: string): OmikujiWorld {
  mkdirSync(dataDir, { recursive: true });
  const cfg: OmikujiConfigSection = { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording };
  return new OmikujiWorld({ cfg, timezone: 'Asia/Shanghai', dataDir, packageDir: PACKAGE_DIR, content });
}

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('builtin 模式仍然是成句，且不给 omikuji_record', async () => {
  const world = makeWorld('builtin', freshDir('builtin'));
  const names = world.tools().map((tool) => tool.name);
  assert.deepEqual(names, ['omikuji_draw']);
  const receipt = await world.tools()[0]!.handler({ date: '2026-11-23' }, {} as never);
  assert.match(receipt as string, /签文：/);
  assert.match(receipt as string, /^精灵日签 · 2026-11-23/m);
});

test('pet 模式交回事实与约束，不给成句', async () => {
  const world = makeWorld('pet', freshDir('pet-brief'));
  const sign = world.signFor('2026-11-23');
  const receipt = (await world.tools()[0]!.handler({ date: '2026-11-23' }, {} as never)) as string;

  assert.match(receipt, /第 \d+ 签 · \S+ · \d+ 分/);
  assert.match(receipt, /签文和解签都由你来写/);
  assert.match(receipt, /凶档也不许吓人/);
  assert.match(receipt, /别在每句回话后面再带一遍/);
  assert.ok(!receipt.includes('相信科学'), 'the disclaimer belongs to the panel, not the receipt');
  assert.match(receipt, new RegExp(sign.tone));
  for (const image of sign.images) assert.ok(receipt.includes(image), `brief must offer ${image}`);
  assert.doesNotMatch(receipt, /签文：/, 'pet mode must not hand over a finished verse');
  assert.doesNotMatch(receipt, new RegExp(sign.poem));
  assert.ok(!existsSync(wordingFilePath(join(root, 'pet-brief'), '2026-11-23')));
});

test('签文与解签一起记下，同一天再取原样返回', async () => {
  const dir = freshDir('pet-record');
  const world = makeWorld('pet', dir);
  const [, record] = world.tools();
  assert.equal(record!.name, 'omikuji_record');

  const written = '檐下先站着，等雨小一点再走。';
  const reading = '今天不必赶路。把想做的排一件就够，剩下的明天再说。';
  const confirmation = (await record!.handler({ text: written, reading, date: '2026-11-23' }, {} as never)) as string;
  assert.match(confirmation, /已记下 2026-11-23 的签文与解签/);
  assert.ok(confirmation.includes(written));
  assert.ok(confirmation.includes(reading), '解签也要回显');

  const again = (await world.tools()[0]!.handler({ date: '2026-11-23' }, {} as never)) as string;
  assert.ok(again.startsWith(written), 'the stored verse must be returned verbatim');
  assert.ok(again.includes(reading), '解签跟着签文一起回来');
  assert.match(again, /已记下的那份/);

  // 换一个进程内的实例读同一份文件，措辞不变：落盘才是权威，内存不是。
  const remounted = makeWorld('pet', dir);
  const fromDisk = (await remounted.tools()[0]!.handler({ date: '2026-11-23' }, {} as never)) as string;
  assert.equal(fromDisk, again);

  const onDisk = JSON.parse(readFileSync(wordingFilePath(dir, '2026-11-23'), 'utf8')) as Record<string, { text: string; reading?: string }>;
  assert.equal(onDisk['2026-11-23']!.text, written);
  assert.equal(onDisk['2026-11-23']!.reading, reading);
});

test('只给签文不给解签也能记（老调用方式）', async () => {
  const dir = freshDir('pet-verse-only');
  const world = makeWorld('pet', dir);
  const [, record] = world.tools();
  const confirmation = (await record!.handler({ text: '只给签文也可以。', date: '2026-11-24' }, {} as never)) as string;
  assert.ok(confirmation.includes('只给签文也可以。'));
  const onDisk = JSON.parse(readFileSync(wordingFilePath(dir, '2026-11-24'), 'utf8')) as Record<string, { reading?: string }>;
  assert.equal(onDisk['2026-11-24']!.reading, undefined, '没给解签就不存这个字段');
  const again = (await world.tools()[0]!.handler({ date: '2026-11-24' }, {} as never)) as string;
  assert.ok(again.startsWith('只给签文也可以。'));
});

test('同一天只认第一份，重写不覆盖', async () => {
  const world = makeWorld('pet', freshDir('pet-keep'));
  const [, record] = world.tools();
  await record!.handler({ text: '第一份。', date: '2026-12-01' }, {} as never);
  const second = (await record!.handler({ text: '第二份。', date: '2026-12-01' }, {} as never)) as string;
  assert.match(second, /保留的是先写下的那份/);
  assert.ok(second.includes('第一份。'));
  assert.ok(!second.includes('第二份。'));
});

test('别的日期、别的月份各自独立', async () => {
  const dir = freshDir('pet-isolation');
  const world = makeWorld('pet', dir);
  const [draw, record] = world.tools();
  await record!.handler({ text: '十一月那天写的。', date: '2026-11-30' }, {} as never);
  await record!.handler({ text: '十二月那天写的。', date: '2026-12-01' }, {} as never);

  assert.ok(((await draw!.handler({ date: '2026-11-30' }, {} as never)) as string).startsWith('十一月那天写的。'));
  assert.ok(((await draw!.handler({ date: '2026-12-01' }, {} as never)) as string).startsWith('十二月那天写的。'));
  assert.match((await draw!.handler({ date: '2026-11-29' }, {} as never)) as string, /签文和解签都由你来写/);
  assert.ok(existsSync(wordingFilePath(dir, '2026-11-30')), 'November file must exist');
  assert.ok(existsSync(wordingFilePath(dir, '2026-12-01')), 'December file must exist');
  assert.notEqual(wordingFilePath(dir, '2026-11-30'), wordingFilePath(dir, '2026-12-01'));
});

test('正文校验：空串、非字符串、超长都拒绝', async () => {
  const world = makeWorld('pet', freshDir('pet-validate'));
  const [, record] = world.tools();
  const handler = record!.handler;
  await assert.rejects(handler({ text: '   ' }, {} as never), RangeError);
  await assert.rejects(handler({ text: 42 }, {} as never), TypeError);
  await assert.rejects(handler({ text: '字'.repeat(201) }, {} as never), RangeError);
  await assert.rejects(handler({ text: '好的。', date: '2026-02-30' }, {} as never), RangeError);
});

test('环境段说清措辞归谁写', () => {
  const petVars = makeWorld('pet', freshDir('env-pet')).envPromptVars();
  assert.match(petVars!['omikuji.mode']!, /written by you/);
  assert.match(petVars!['omikuji.hint']!, /omikuji_draw for the brief/);

  const builtinVars = makeWorld('builtin', freshDir('env-builtin')).envPromptVars();
  assert.match(builtinVars!['omikuji.mode']!, /built-in/);
  assert.match(builtinVars!['omikuji.hint']!, /omikuji_draw for the verse/);
});

test('默认让桌宠自己写：缺省配置下就暴露两个工具，回执是约束不是成句', async () => {
  assert.equal(OMIKUJI_DEFAULTS.wording, 'pet', 'default wording must be pet');
  const dir = freshDir('default-mode');
  const world = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    content,
  });
  assert.deepEqual(world.tools().map((tool) => tool.name), ['omikuji_draw', 'omikuji_record']);
  const receipt = (await world.tools()[0]!.handler({ date: '2026-11-23' }, {} as never)) as string;
  assert.match(receipt, /签文和解签都由你来写/);
  assert.doesNotMatch(receipt, /签文：/);
});

test('模式热切换：改配置下一次调用即生效', async () => {
  const dir = freshDir('pet-hot');
  const cfg: OmikujiConfigSection = { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'builtin' };
  const world = new OmikujiWorld({ cfg, timezone: 'Asia/Shanghai', dataDir: dir, packageDir: PACKAGE_DIR, content });
  assert.equal(world.tools().length, 1);
  cfg.wording = 'pet';
  assert.equal(world.tools().length, 2);
  assert.doesNotMatch((await world.tools()[0]!.handler({ date: '2026-11-23' }, {} as never)) as string, /签文：/);
});

test('分数与档位不受措辞模式影响', () => {
  for (const date of ['2026-11-23', '2026-06-01', '2027-01-15']) {
    const builtin = drawSign(date, SALT, content);
    const pet = drawSign(date, SALT, content);
    assert.equal(pet.score, builtin.score);
    assert.equal(pet.lot, builtin.lot);
    assert.equal(pet.tierLabel, builtin.tierLabel);
  }
});
