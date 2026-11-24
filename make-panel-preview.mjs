#!/usr/bin/env node
/**
 * 生成一个能直接双击打开的 `panel-preview.html`：真面板 + 真样式 + 一份打包时算好的快照。
 *
 *   node --experimental-transform-types make-panel-preview.mjs
 *
 * 用途：调抽签动画。改 `cortico-world-omikuji/dist/webui.css` 里 `.om-reveal` 的关键帧，
 * 重跑这个脚本（或者直接在浏览器 devtools 里改样式），按「抽今天的签」就能看到效果，
 * 不需要装进 Coopanion。
 *
 * 预览里的签是生成时按包内真实逻辑算好的一份快照（固定盐、内置文案），不是活的；
 * 按钮只会把同一份数据再渲染一次 —— 足够看动效，不足以验数据。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSignContent } from './cortico-world-omikuji/src/content.ts';
import { drawSign } from './cortico-world-omikuji/src/daily.ts';
import { panelSnapshot, PANEL_ID } from './cortico-world-omikuji/src/panel.ts';
import { saveWording } from './cortico-world-omikuji/src/wording.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = join(root, 'cortico-world-omikuji');
const css = readFileSync(join(pkg, 'dist/webui.css'), 'utf8');
const js = readFileSync(join(pkg, 'dist/webui.js'), 'utf8');

// 用真逻辑造一份快照：今天的正片 + 七天横排。
const dataDir = join(root, '.tmp-preview');
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
const content = loadSignContent();
const SALT = 'preview0salt0000';
const today = new Date().toISOString().slice(0, 10);
const signFor = (date) => drawSign(date, SALT, content);
saveWording(dataDir, today, '檐下站一会儿，等雨小些再走。', `${today}T09:00:00+08:00`);

const builtin = panelSnapshot({ mode: 'builtin', dataDir, packageDir: pkg, today, signFor, drawFor: signFor });
const pet = panelSnapshot({ mode: 'pet', dataDir, packageDir: pkg, today, signFor, drawFor: signFor });
for (const mode of ['builtin', 'pet']) {
  rmSync(join(dataDir, 'omikuji-wording-' + today.slice(0, 7) + '.json'), { force: true });
  if (mode === 'pet') saveWording(dataDir, today, '檐下站一会儿，等雨小些再走。', `${today}T09:00:00+08:00`);
}
rmSync(dataDir, { recursive: true, force: true });

// 把 export default 换成挂到全局，浏览器里就不用处理模块解析。
const bundleJs = js.replace(/export\s+default\s+/, 'globalThis.__omikujiBundle = ');

// 把包里的抽签动画嵌成 data URL，预览才能离线看到真动画。
const videoPath = join(pkg, 'assets/draw.mp4');
const videoDataUrl = existsSync(videoPath)
  ? `data:video/mp4;base64,${readFileSync(videoPath).toString('base64')}`
  : '';

// 面板的动态背景同理：有 assets/panel-bg.* 就一起内联，预览里就能看到真背景
const bgPath = ['mp4', 'webm', 'mov', 'gif', 'webp', 'png']
  .map((ext) => join(pkg, `assets/panel-bg.${ext}`))
  .find((candidate) => existsSync(candidate));
const bgMime = bgPath?.endsWith('.webm') ? 'video/webm'
  : bgPath?.endsWith('.mov') ? 'video/quicktime'
  : bgPath?.endsWith('.gif') ? 'image/gif'
  : bgPath?.endsWith('.webp') ? 'image/webp'
  : bgPath?.endsWith('.png') ? 'image/png'
  : 'video/mp4';
const avatarPath = ['jpg', 'jpeg', 'png', 'webp', 'svg']
  .map((ext) => join(pkg, `assets/avatar.${ext}`))
  .find((candidate) => existsSync(candidate));
const avatarMime = avatarPath?.endsWith('.png') ? 'image/png' : avatarPath?.endsWith('.webp') ? 'image/webp' : avatarPath?.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
const avatarDataUrl = avatarPath ? `data:${avatarMime};base64,${readFileSync(avatarPath).toString('base64')}` : '';

const bgDataUrl = bgPath && readFileSync(bgPath).length <= 8 * 1024 * 1024
  ? `data:${bgMime};base64,${readFileSync(bgPath).toString('base64')}`
  : '';
const bgSkipped = Boolean(bgPath) && bgDataUrl === '';

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>精灵日签 · 面板预览</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; background: #14161c; color: #e6e8ee;
         font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 18px;
         font-size: 12px; color: #9aa3b2; }
  .bar button { font: inherit; padding: 5px 12px; border-radius: 8px; cursor: pointer;
                border: 1px solid #39404e; background: #1d2129; color: #e6e8ee; }
  .bar button.on { border-color: #4a86e8; color: #fff; background: #23304a; }
  .panel { max-width: 720px; }
  /* 预览壳用的主题变量，模拟宿主注入的那些 */
  .panel {
    --ink: #e6e8ee; --ink-soft: #b9c0cc; --ink-dim: #8b93a1;
    --line: #2c313c; --line-2: #3a4150; --paper: #191d24; --paper-2: #1f242d;
    --hover: rgba(255,255,255,.07); --accent: #4a86e8; --on-accent: #fff; --danger: #e06c65;
    --radius-md: 9px; --radius-lg: 14px;
  }
${css}
</style>
</head>
<body>
<div class="bar">
  <span>精灵日签 · 面板预览（数据是生成时算好的快照）${bgSkipped ? "　·　背景视频太大（>8 MB）未内联，预览里不显示背景" : ""}</span>
  <button data-mode="builtin" class="on">内置文案</button>
  <button data-mode="pet">桌宠自己写</button>
  <button id="reset">重置成封着的状态</button>
</div>
<div class="panel" id="root"></div>
<script type="module">
${bundleJs}

const SNAPSHOTS = ${JSON.stringify({ builtin, pet })};
let mode = 'builtin';
const drawn = new Map();
const memoStore = new Map();

function mount() {
  const host = document.getElementById('root');
  host.replaceChildren();
  const ctx = {
    pageId: 'world:omikuji',
    panelId: '${PANEL_ID}',
    language: 'zh',
    root: host,
    signal: new AbortController().signal,
    memo: { get: (k, f) => (memoStore.has(mode + ':' + k) ? memoStore.get(mode + ':' + k) : f),
            set: (k, v) => void memoStore.set(mode + ':' + k, v) },
    invoke: async (method) => {
      // 预览里 snapshot 与 draw 给同一份数据；draw 额外让卡片带上 om-reveal 钩子。
      drawn.set(mode, method === 'draw' || drawn.get(mode));
      return SNAPSHOTS[mode];
    },
    // 预览内联了包里的 draw.mp4（抽签动画）、panel-bg.*（背景视频或动图）、avatar.*（头像）
    invokeBinary: async (method) => {
      const url = method === 'background'
        ? ${JSON.stringify(bgDataUrl)}
        : method === 'avatar'
          ? ${JSON.stringify(avatarDataUrl)}
          : ${JSON.stringify(videoDataUrl)};
      if (!url) return new Blob(['{}'], { type: 'application/json' });
      return await (await fetch(url)).blob();
    },
    timeout: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      return { dispose: () => clearTimeout(handle) };
    },
  };
  globalThis.__omikujiBundle.panels.now.mount(ctx);
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach((other) => other.classList.toggle('on', other === button));
    mode = button.dataset.mode;
    memoStore.clear();
    drawn.clear();
    mount();
  });
});
document.getElementById('reset').addEventListener('click', () => {
  memoStore.clear();
  drawn.clear();
  mount();
});
mount();
</script>
</body>
</html>
`;

const out = join(root, 'panel-preview.html');
writeFileSync(out, html, 'utf8');
console.log(`✓ ${out}`);
console.log(`  内置模式：第 ${builtin.sign.lot} 签 · ${builtin.sign.tierLabel} · ${builtin.sign.score} 分`);
console.log(`  pet 模式：${pet.written ? '已写：' + pet.written : '未写'}`);
console.log(`  双击打开，按「抽今天的签」看翻开效果；动画改 dist/webui.css 的 .om-reveal`);
