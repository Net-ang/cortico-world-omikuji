/**
 * 生成并核对 describe.json。用的是框架自己的导出器，不是手写 JSON。
 *
 *   node tools/describe.ts          # 写 describe.json 并核对自己
 *   node tools/describe.ts --check  # 只核对，不写
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDescribe, DEFAULT_DESCRIBE_FILE, exportDescribe } from 'cortico/extensions/describe-export.ts';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import type { WorldDefinition, WorldSection } from 'cortico/world.ts';
import OMIKUJI from '../src/index.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const opts = { scratchDir: join(packageDir, '.tmp-describe'), packageDir, repoRoot: packageDir };
const checkOnly = process.argv.includes('--check');

const file = await exportDescribe('world', OMIKUJI, opts);
if (!file) throw new Error('OMIKUJI has no describe; add one to definition.ts');

if (!checkOnly) {
  writeFileSync(join(packageDir, DEFAULT_DESCRIBE_FILE), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  console.log(`wrote ${DEFAULT_DESCRIBE_FILE}: ${file.tools?.length ?? 0} tools, ${file.events?.length ?? 0} events, ${file.prompts?.length ?? 0} prompts`);
}

const report = await checkDescribe('world', OMIKUJI, DEFAULT_DESCRIBE_FILE, opts);
for (const line of report.ok) console.log(`ok    ${line}`);
for (const line of report.warnings) console.log(`warn  ${line}`);
for (const line of report.failures) console.log(`FAIL  ${line}`);

// 干装载：manifest、配置组路径与默认值、工具前缀、事件形状，比自描述检查更接近装上那一刻。
const mount = await dryMountWorld(OMIKUJI as WorldDefinition<WorldSection>, { ...opts, hasWebUiClient: true });
for (const line of mount.ok) console.log(`ok    ${line}`);
for (const line of mount.warnings) console.log(`warn  ${line}`);
for (const line of mount.failures) console.log(`FAIL  ${line}`);

if (report.failures.length + mount.failures.length > 0) process.exitCode = 1;
