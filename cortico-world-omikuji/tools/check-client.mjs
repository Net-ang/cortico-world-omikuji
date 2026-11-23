/**
 * 浏览器端产物的离线检查：不渲染，只核对契约。
 *
 * - `dist/webui.js` 是不是宿主认的那种 bundle（框架自己的 isWebUiClientBundle）。
 * - `webUi()` 声明的每个面板，客户端都实现了 mount；反之客户端没实现多余面板。
 * - manifest 声明的 webUiClient / webUiStyle 文件确实在包里。
 *
 *   node --experimental-transform-types tools/check-client.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import bundle from '../dist/webui.js';
import OMIKUJI from '../src/index.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const ok = [];

if (!isWebUiClientBundle(bundle)) {
  failures.push('dist/webui.js does not export { panels: { ... } }; the host would reject it as not-an-extension.');
} else {
  ok.push(`bundle shape: panels = [${Object.keys(bundle.panels).join(', ')}]`);
}

const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
for (const key of ['webUiClient', 'webUiStyle']) {
  const rel = pkg.cortico?.[key];
  if (!rel) failures.push(`package.json cortico.${key} is missing; the host has nothing to load.`);
  else if (!existsSync(join(packageDir, rel))) failures.push(`cortico.${key} points to ${rel}, which is not in the package.`);
  else ok.push(`${key} → ${rel}`);
}

// 干装载拿声明的面板 id；与 bundle 实现对账。
const world = OMIKUJI.create({
  id: OMIKUJI.id,
  cfg: OMIKUJI.defaults(),
  timezone: 'Asia/Shanghai',
  botName: 'test',
  botDir: join(packageDir, '.tmp-describe'),
  packageDir,
  dataDir: join(packageDir, '.tmp-describe', 'data'),
  repoRoot: packageDir,
  secret: () => '',
  storeSecret: () => {},
  persist: () => {},
  restart: async () => {},
});
const declared = (world.webUi?.('zh')?.panels ?? []).map((panel) => panel.id);
const implemented = isWebUiClientBundle(bundle) ? Object.keys(bundle.panels) : [];
for (const id of declared) {
  if (!implemented.includes(id)) failures.push(`panel "${id}" is declared but the client bundle has no mount for it.`);
}
for (const id of implemented) {
  if (!declared.includes(id)) failures.push(`client bundle implements panel "${id}", which webUi() does not declare.`);
  const panel = isWebUiClientBundle(bundle) ? bundle.panels[id] : undefined;
  if (panel && typeof panel.mount !== 'function') failures.push(`panel "${id}" has no mount() function.`);
}
if (declared.length && declared.length === implemented.length) ok.push(`panels match: ${declared.join(', ')}`);

for (const line of ok) console.log(`ok    ${line}`);
for (const line of failures) console.log(`FAIL  ${line}`);
if (failures.length > 0) process.exitCode = 1;
