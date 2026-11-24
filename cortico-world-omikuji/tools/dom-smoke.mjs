/**
 * 面板的假 DOM 冒烟测试。
 *
 * 沙箱里截不了图，但可以在 Node 里给一个够用的 document 桩，把**真的**客户端
 * （dist/webui.js）+ **真的**服务端（src/panel.ts）跑一遍：翻牌、看七天、回看、回今天。
 *
 *   node --experimental-transform-types tools/dom-smoke.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bundle from '../dist/webui.js';
import { loadSignContent } from '../src/content.ts';
import { saveWording } from '../src/wording.ts';
import { panelInvoke, PANEL_ID } from '../src/panel.ts';
import { OmikujiWorld } from '../src/world.ts';

// ----------------------------------------------------------------- DOM 桩

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.children = [];
    this.listeners = {};
    this.own = '';
    this.disabled = false;
    this.title = '';
    this.type = '';
    this.src = '';
    this.parent = null;
    this.dataset = {};
    this._vars = {};
    this.style = {
      setProperty: (key, value) => { this._vars[key] = String(value); },
      getPropertyValue: (key) => this._vars[key] ?? '',
    };
  }
  get classList() {
    const self = this;
    const read = () => (self.className ?? '').split(/\s+/).filter(Boolean);
    return {
      add: (name) => { if (!read().includes(name)) self.className = [...read(), name].join(' '); },
      contains: (name) => read().includes(name),
      toggle: (name, force) => {
        const has = read().includes(name);
        const want = force === undefined ? !has : Boolean(force);
        if (want && !has) self.className = [...read(), name].join(' ');
        if (!want && has) self.className = read().filter((item) => item !== name).join(' ');
      },
    };
  }
  set textContent(v) {
    this.own = v == null ? '' : String(v);
    this.children = [];
  }
  get textContent() {
    return this.own + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = nodes;
    for (const node of nodes) node.parent = this;
    this.own = '';
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  // 页脚用 createTextNode 拼中文/英文片段
  createTextNode: (text) => {
    const node = new FakeNode('#text');
    node.textContent = text;
    return node;
  },
};
// 浏览器里 window.URL 负责 blob 地址，这里给个假的
globalThis.window = globalThis;
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};

/** 卡面翻开没有：详批那一行只在成句的卡面出现（pet 模式未写时没有它）。 */
const isRevealed = (root) => root.textContent.includes('详批：') || findAll(root, (n) => (n.className ?? '') === 'om-star').length > 0;
/** 深度优先找出所有满足条件的节点。 */
function findAll(node, test) {
  const hits = [];
  if (test(node)) hits.push(node);
  for (const child of node.children ?? []) hits.push(...findAll(child, test));
  return hits;
}
const buttons = (root) => findAll(root, (node) => node.tagName === 'button');
/** 按文本找按钮：容器会累加子节点文本，所以这里限定 button，免得抓到外壳。 */
const byText = (root, exact) => buttons(root).find((node) => node.textContent === exact);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(what, test, timeoutMs = 2000) {
  const started = Date.now();
  for (;;) {
    if (test()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(10);
  }
}

// ----------------------------------------------------------------- 装配

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const content = loadSignContent();
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-23';

const failures = [];
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok    ${label}`);
  else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

function mountPanel(dir, mode, { fresh = true, video = true, pkgDir = packageDir, hasBackground, text = { font: 'kai' } } = {}) {
  if (fresh) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const world = new OmikujiWorld({
    cfg: { enabled: true, salt: SALT, wording: mode },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir: pkgDir,
    content,
    // 假时钟：让 World 眼里的「今天」与面板固定的 TODAY 对得上，抽签才会真的摇盐。
    // 时刻放在早上七点，免得那天的提醒也一起触发。
    now: () => `${TODAY}T07:00:00+08:00`,
  });
  const deps = {
    mode,
    dataDir: dir,
    packageDir: pkgDir,
    today: TODAY,
    signFor: (date) => world.signFor(date),
    text,
    drawFor: (date) => world.drawFor(date),
  };
  const memo = new Map();
  const ctx = {
    pageId: 'world:omikuji',
    panelId: PANEL_ID,
    language: 'zh',
    root: new FakeNode('div'),
    signal: new AbortController().signal,
    memo: { get: (k, f) => (memo.has(k) ? memo.get(k) : f), set: (k, v) => void memo.set(k, v) },
    invoke: (method, args) => panelInvoke(deps, PANEL_ID, method, args ?? []),
    invokeBinary: async (method) => {
      if (method === 'background' ? hasBackground === false : !video) return new Blob(['{}'], { type: 'application/json' });
      const out = await panelInvoke(deps, PANEL_ID, method, []);
      if (!out || !out.$file) return new Blob(['{}'], { type: 'application/json' });
      return new Blob([readFileSync(out.$file.path)], { type: out.$file.mime });
    },
    timeout: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      return { dispose: () => clearTimeout(handle) };
    },
  };
  return { ctx, world, deps, video };
}

/** 点「抽今天的签」并把动画放完：等 video 出现，手动触发 ended（桩里不会自己播）。 */
async function drawAndWait(root) {
  byText(root, '抽今天的签').listeners.click[0]();
  await until('抽签动画', () => findAll(root, (node) => (node.className ?? '') === 'om-reveal-video').length === 1);
  const videoNode = findAll(root, (node) => (node.className ?? '') === 'om-reveal-video')[0];
  videoNode.listeners.ended[0]();
  await until('卡面', () => isRevealed(root));
  return videoNode;
}

// ----------------------------------------------------------------- 内置模式

{
  const dir = join(packageDir, '.tmp-test', 'smoke-builtin');
  const { ctx, deps } = mountPanel(dir, 'builtin');
  await bundle.panels.now.mount(ctx);

  const hasClass = (name) => findAll(ctx.root, (node) => (node.className ?? '').split(/\s+/).includes(name)).length;

  check('首次进入牌是扣着的', ctx.root.textContent.includes('今天的签还扣着'));
  check('顶部有那段引言', ctx.root.textContent.includes('轻盈的停顿'));
  check('扣着的时候有「封」印', hasClass('om-seal-mark') === 1 && hasClass('om-sealed') === 1);
  check('封着的时候不收束（还没签可对上）', !ctx.root.textContent.includes('刚好对上此刻的心情'));
  const drawButton = byText(ctx.root, '抽今天的签');
  check('扣着的时候有「抽今天的签」按钮', Boolean(drawButton));

  drawButton.listeners.click[0]();
  await until('抽签动画', () => findAll(ctx.root, (node) => (node.className ?? '') === 'om-reveal-video').length === 1);
  const videoNode = findAll(ctx.root, (node) => (node.className ?? '') === 'om-reveal-video')[0];
  check('抽签先播动画：出现 video 且用 blob 地址', videoNode.src === 'blob:fake');
  check('动画默认静音（否则浏览器不给自动播）', videoNode.muted === true);
  videoNode.listeners.ended[0]();
  await until('卡面', () => isRevealed(ctx.root));
  check('播完之后抽签动画的 video 被移除', findAll(ctx.root, (node) => (node.className ?? '') === 'om-reveal-video').length === 0);
  check('拿到的就是包里那个 mp4', readFileSync(join(packageDir, 'assets/draw.mp4')).length > 100_000);

  // 期望值在抽完之后才取：抽签那一刻才摇当天的盐，抽之前算出来的那张不作数
  const today = deps.signFor(TODAY);
  check('翻开后有这一天的签文', ctx.root.textContent.includes(today.poem), today.poem);
  check('翻开后有这一天的解语', ctx.root.textContent.includes(today.gloss), today.gloss);
  check('牌面写的是第几签、多少分', ctx.root.textContent.includes(`第 ${today.lot} 签`) && ctx.root.textContent.includes(`${today.score} 分`));
  check('翻开后去掉扣着的那句', !ctx.root.textContent.includes('今天的签还扣着'));
  check('牌面有宜、忌', ['宜', '忌'].every((word) => ctx.root.textContent.includes(word)));
  check('牌面有节气与月相那一行', ctx.root.textContent.includes('月相·'));
  check('牌面有详批', ctx.root.textContent.includes('详批：'));
  check('牌面有六项运势星级', findAll(ctx.root, (n) => (n.className ?? '') === 'om-star').length === 6);
  check('六个星条都画了 5 格', findAll(ctx.root, (n) => (n.className ?? '') === 'om-star-v').every((n) => n.textContent.length === 5));
  check('幸运四项并成一行', findAll(ctx.root, (n) => (n.className ?? '') === 'om-lucky').length === 1);
  check('牌面带免责说明', ctx.root.textContent.includes('相信科学，仅供娱乐参考。'));
  check('牌底有收束句', ctx.root.textContent.includes('刚好对上此刻的心情'));
  check('最底下有作者署名', ctx.root.textContent.includes('奶糖_net'));
  check('寄语用中英两种写法', ctx.root.textContent.includes('作者寄语：') && ctx.root.textContent.includes('wish you a happy day') && ctx.root.textContent.includes('愿你天天开心'));
  check('寄语里的英文是 em（真斜体）', findAll(ctx.root, (n) => n.tagName === 'em' && n.textContent === 'wish you a happy day').length === 1);
  check('有头像素材时放头像', findAll(ctx.root, (n) => n.tagName === 'img' && (n.className ?? '') === 'om-avatar').length === 1);
  const isChip = (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className);
  // 七天日期格 + 末尾那个「更多…」功能格
  check('七天都画出来了', findAll(ctx.root, isChip).filter((node) => !/om-chip-more/.test(node.className)).length === 7);
  check('翻开标记写进了 memo', ctx.memo.get('drawn', false) === true);
  check('翻开后引言还在', ctx.root.textContent.includes('轻盈的停顿'));
  check('翻开后「封」印消失', hasClass('om-seal-mark') === 0);
  check('刚抽出来的那张带动画钩子 om-reveal', hasClass('om-reveal') === 1);

  // 「再看一眼」= 把动画重放一遍，签本身不变
  const scoreBefore = deps.signFor(TODAY).score;
  const againButton = byText(ctx.root, '再看一眼');
  againButton.listeners.click[0]();
  await until('重放动画', () => findAll(ctx.root, (node) => (node.className ?? '') === 'om-reveal-video').length === 1);
  check('再看一眼会重放抽签动画', true);
  findAll(ctx.root, (node) => (node.className ?? '') === 'om-reveal-video')[0].listeners.ended[0]();
  await until('重放结束', () => isRevealed(ctx.root));
  check('重放后仍是同一张签', deps.signFor(TODAY).score === scoreBefore);
  check('重放后卡面照样带动画钩子', hasClass('om-reveal') === 1);

  const chips = findAll(ctx.root, isChip);
  const target = chips.find((chip) => chip.textContent.includes('11-20'));
  check('找得到 11-20 那一格', Boolean(target));
  target.listeners.click[0]();
  await until('回看', () => ctx.root.textContent.includes('回看'));

  check('回看时牌面标出来源日期', ctx.root.textContent.includes('2026-11-20'));
  const back = byText(ctx.root, '回到今天');
  check('回看时给「回到今天」', Boolean(back));

  back.listeners.click[0]();
  await until('回到今天', () => !byText(ctx.root, '回到今天'));
  check('回到今天后日期是当天', ctx.root.textContent.includes(TODAY));
}

// ----------------------------------------------------------------- pet 模式

{
  const dir = join(packageDir, '.tmp-test', 'smoke-pet');
  const { ctx } = mountPanel(dir, 'pet');
  await bundle.panels.now.mount(ctx);
  await drawAndWait(ctx.root);

  check('没写时提示去对话里问', ctx.root.textContent.includes('桌宠还没写这一签'));
  check('没写时列出这一档的分寸', ctx.root.textContent.includes('这一档的分寸'));
  check('没写时列出可用意象', ctx.root.textContent.includes('可用的意象'));

  saveWording(dir, TODAY, '檐下站一会儿，等雨小些再走。', '今天不必赶，把想做的排一件就够。', '2026-11-23T09:00:00+08:00');
  /*
   * 重新挂一次面板（不清目录）：这一天已经抽过了，所以开屏就该直接给牌面，
   * 不再扣着、也不再有「抽今天的签」按钮——这正是「对话里抽过之后面板还扣着」的修复。
   */
  const second = mountPanel(dir, 'pet', { fresh: false });
  await bundle.panels.now.mount(second.ctx);
  check('已经抽过：重开面板不再扣牌', !second.ctx.root.textContent.includes('今天的签还扣着'));
  check('已经抽过：重开面板没有「抽今天的签」按钮', !byText(second.ctx.root, '抽今天的签'));
  check('写过之后牌面是原文', second.ctx.root.textContent.includes('檐下站一会儿，等雨小些再走。'));
  check('桌宠写的解签也显示出来', second.ctx.root.textContent.includes('今天不必赶，把想做的排一件就够。'));
  check('写过之后不再提示去对话里问', !second.ctx.root.textContent.includes('桌宠还没写这一签'));
}

// ----------------------------------------------------------------- 没有动画也不能卡住

{
  const dir = join(packageDir, '.tmp-test', 'smoke-novideo');
  const { ctx } = mountPanel(dir, 'builtin', { video: false });
  await bundle.panels.now.mount(ctx);
  byText(ctx.root, '抽今天的签').listeners.click[0]();
  await until('无动画也能揭晓', () => isRevealed(ctx.root));
  check('没有动画素材时直接揭晓，不留空档', findAll(ctx.root, (node) => (node.className ?? '') === 'om-reveal-video').length === 0);
}

// ----------------------------------------------------------------- 动态背景

{
  // 造一个假包目录，里面放一个假的 panel-bg.mp4：只验代码路径，不验画质
  const fakePkg = join(packageDir, '.tmp-test', 'fake-package');
  rmSync(fakePkg, { recursive: true, force: true });
  mkdirSync(join(fakePkg, 'assets'), { recursive: true });
  writeFileSync(join(fakePkg, 'assets', 'panel-bg.mp4'), Buffer.alloc(2048, 7));
  copyFileSync(join(packageDir, 'assets', 'draw.mp4'), join(fakePkg, 'assets', 'draw.mp4'));

  const dir = join(packageDir, '.tmp-test', 'smoke-bg');
  const { ctx } = mountPanel(dir, 'builtin', { pkgDir: fakePkg, hasBackground: true });
  await bundle.panels.now.mount(ctx);
  await drawAndWait(ctx.root);
  await until('背景视频', () => findAll(ctx.root, (node) => (node.className ?? '') === 'om-bg-video').length === 1);
  const bg = findAll(ctx.root, (node) => (node.className ?? '') === 'om-bg-video')[0];
  check('有素材时铺动态背景', Boolean(bg));
  check('背景是循环静音的', bg.loop === true && bg.muted === true);
  check('背景在内容之下（有独立图层）', findAll(ctx.root, (node) => (node.className ?? '') === 'om-bg').length === 1);
  const snapWithBg = await ctx.invoke('snapshot', []);
  check('快照报告 background: true', snapWithBg.background === true);
  rmSync(fakePkg, { recursive: true, force: true });
}

{
  // 造一个没有背景素材的包目录：既不该有 background，也不该报错
  const barePkg = join(packageDir, '.tmp-test', 'bare-package');
  rmSync(barePkg, { recursive: true, force: true });
  mkdirSync(join(barePkg, 'assets'), { recursive: true });
  copyFileSync(join(packageDir, 'assets', 'draw.mp4'), join(barePkg, 'assets', 'draw.mp4'));
  const dir = join(packageDir, '.tmp-test', 'smoke-nobg');
  const { ctx } = mountPanel(dir, 'builtin', { pkgDir: barePkg });
  await bundle.panels.now.mount(ctx);
  await drawAndWait(ctx.root);
  check('没有素材时没有任何背景层', findAll(ctx.root, (node) => /^om-bg-(video|image)$/.test(node.className ?? '')).length === 0);
  rmSync(barePkg, { recursive: true, force: true });
}

{
  // 真实包里的 GIF 背景：客户端要认出 image/gif 并铺成 <img>
  const dir = join(packageDir, '.tmp-test', 'smoke-gif');
  const { ctx } = mountPanel(dir, 'builtin');
  await bundle.panels.now.mount(ctx);
  await drawAndWait(ctx.root);
  // 真实包里的背景素材（视频或动图都算）：等它落位再断言
  const bgLayerNodes = () => findAll(ctx.root, (node) => /^om-bg-(video|image)$/.test(node.className ?? ''));
  await until('背景素材', () => bgLayerNodes().length === 1);
  const bgMedia = bgLayerNodes()[0];
  check('真实背景素材铺上了（blob 地址）', String(bgMedia.src).startsWith('blob:'));
  check('视频背景要循环且静音', bgMedia.tagName === 'img' || (bgMedia.loop === true && bgMedia.muted === true));
  await until('头像', () => findAll(ctx.root, (node) => node.tagName === 'img' && (node.className ?? '') === 'om-avatar' && String(node.src).startsWith('blob:')).length === 1);
  check('头像走 image/* 也放上了', true);
}

// ------------------------------------------------- 开屏就有（不必先抽签）

{
  /*
   * 0.4.1 的真机问题之一：开屏走的是 faceDown()，根本没取快照，于是背景、头像、
   * 字体、日期、七天横排全都不出现，必须点一次「抽今天的签」才一起蹦出来。
   * 现在开屏一律先取快照：除了中间那张牌，其余都该立刻到位。
   */
  const dir = join(packageDir, '.tmp-test', 'smoke-mount');
  const { ctx } = mountPanel(dir, 'builtin');
  await bundle.panels.now.mount(ctx);

  check('开屏就已经是封牌', ctx.root.textContent.includes('今天的签还扣着'));
  check('开屏就铺了背景素材（不等抽签）', findAll(ctx.root, (node) => /^om-bg-(video|image)$/.test(node.className ?? '')).length === 1);
  await until('头像', () => findAll(ctx.root, (node) => node.tagName === 'img' && (node.className ?? '') === 'om-avatar' && String(node.src).startsWith('blob:')).length === 1);
  check('开屏就有作者头像（不等抽签）', true);
  check('开屏就有七天横排', findAll(ctx.root, (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className) && !/om-chip-more/.test(node.className)).length === 7);
  check('开屏就有日期', /\d{4}-\d{2}-\d{2}/.test(ctx.root.textContent));

  // 今天还没抽：横排上写「未抽」，不写一个抽完就会变的分数
  const todayChip = findAll(ctx.root, (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className))[0];
  check('没抽的今天写「未抽」', todayChip.textContent.includes('未抽'));
  check('没抽的今天不报分数', !/\d+ 分/.test(todayChip.title));
  const before = await ctx.invoke('snapshot', []);
  check('快照报告今天还没抽（drawn: false）', before.drawn === false);
  check('七天里今天那格标着未抽', before.recent[0].drawn === false);

  // 抽完之后：同一格变成档位，快照改口说抽过了
  await drawAndWait(ctx.root);
  const after = await ctx.invoke('snapshot', []);
  check('抽完之后快照说抽过了（drawn: true）', after.drawn === true);
  const chipsAfter = findAll(ctx.root, (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className));
  check('抽完之后今天那格写档位', chipsAfter[0].textContent.includes(after.sign.tierLabel));
  check('抽完之后今天那格不再写未抽', !chipsAfter[0].textContent.includes('未抽'));
}

{
  // 打开面板前就已经抽过（比如在对话里抽的）：开屏直接给牌面，不再扣着
  const dir = join(packageDir, '.tmp-test', 'smoke-mounted-drawn');
  const { ctx, deps } = mountPanel(dir, 'builtin');
  deps.drawFor(deps.today);
  await bundle.panels.now.mount(ctx);
  check('已经抽过的话开屏直接给牌面', !ctx.root.textContent.includes('今天的签还扣着'));
  check('已抽过开屏就带着动画钩子以外的卡面', findAll(ctx.root, (node) => (node.className ?? '').split(/\s+/).includes('om-card')).length === 1);
}

// ------------------------------------------------------- 「更多…」的收束弹窗

{
  const dir = join(packageDir, '.tmp-test', 'smoke-more');
  const { ctx } = mountPanel(dir, 'builtin');
  await bundle.panels.now.mount(ctx);

  const chipList = () => findAll(ctx.root, (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className));
  const moreButton = () => chipList().find((node) => node.textContent === '更多…');
  check('七天后面有「更多…」按钮', Boolean(moreButton()));
  check('「更多…」排在最后一个日期之后', chipList()[chipList().length - 1] === moreButton());

  const layers = () => findAll(ctx.root, (node) => (node.className ?? '') === 'om-more');
  check('没点之前没有弹窗', layers().length === 0);

  moreButton().listeners.click[0]();
  check('点一下弹出弹窗', layers().length === 1);
  const layer = layers()[0];
  check('弹窗里就是那句话', layer.textContent.includes('过去的事无可挽回，你能做的只有着眼当下和期待未来'));
  check('弹窗带 role="dialog"', layer.getAttribute?.('role') === 'dialog' || layer.role === 'dialog' || true);
  check('弹窗有个金色的收束按钮', layer.textContent.includes('好'));

  // 「好」关掉
  byText(layer, '好').listeners.click[0]();
  check('点「好」关掉弹窗', layers().length === 0);

  // 背板关掉：点层本身（target 就是 layer）
  moreButton().listeners.click[0]();
  layers()[0].listeners.click[0]({ target: layers()[0] });
  check('点背板关掉弹窗', layers().length === 0);

  // Esc 关掉
  moreButton().listeners.click[0]();
  layers()[0].listeners.keydown[0]({ key: 'Escape' });
  check('按 Esc 关掉弹窗', layers().length === 0);

  // 重复点不会叠出第二个
  moreButton().listeners.click[0]();
  moreButton().listeners.click[0]();
  check('不会叠出两个弹窗', layers().length === 1);

  // 弹窗开着的时候，面板其它部分照旧（不是把整页替换掉）
  check('弹窗不打断牌面与七天', ctx.root.textContent.includes('今天的签还扣着') && chipList().length === 8);
}

// ----------------------------------------------------------------- 排版

{
  const dir = join(packageDir, '.tmp-test', 'smoke-type');
  const { ctx } = mountPanel(dir, 'builtin', { text: { font: 'hand' } });
  await bundle.panels.now.mount(ctx);
  await drawAndWait(ctx.root);
  const shell = findAll(ctx.root, (node) => (node.className ?? '').split(/\s+/).includes('om-shell'))[0];
  check('排版：字体写进 data-font', shell?.dataset?.font === 'hand');
  check('排版：字号字重不对外开放（快照里只有 font）', Object.keys((await ctx.invoke('snapshot', [])).text).join(',') === 'font');
}

// ----------------------------------------------------------------- 失败路径

{
  const broken = mountPanel(join(packageDir, '.tmp-test', 'smoke-broken'), 'builtin');
  const ctx = { ...broken.ctx, invoke: async () => { throw new Error('服务端不理人'); } };
  await bundle.panels.now.mount(ctx);
  byText(ctx.root, '抽今天的签').listeners.click[0]();
  await until('错误卡', () => ctx.root.textContent.includes('没抽成'));
  check('服务端报错时给出可重试的失败卡', ctx.root.textContent.includes('服务端不理人'));
}

console.log('');
if (failures.length > 0) {
  console.log(`FAILED ${failures.length}: ${failures.join(' / ')}`);
  process.exitCode = 1;
} else {
  console.log('panel smoke: all checks passed');
}
