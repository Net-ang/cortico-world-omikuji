#!/usr/bin/env node
/**
 * 把整个工程目录一次性推到 GitHub。没有 git 也能跑——走 REST API 的 Git 数据接口：
 * 每个文件建 blob → 建一棵树 → 建一个提交 → 把分支指过去。
 *
 *   node push-github.mjs --repo net-xxx/omikuji --dry-run      # 只看会上传什么
 *   node push-github.mjs --repo net-xxx/omikuji                # 推到已存在的空仓库
 *   node push-github.mjs --repo net-xxx/omikuji --create       # 顺手把仓库建出来
 *
 * token 依次从这些地方找，都不会被打印出来：
 *   --token-file <路径>  →  环境变量 GITHUB_TOKEN  →  本目录 .token  →  E:\DSH-PET\.github-token
 *
 * 需要的权限：目标仓库的 Contents: Read and write；加 --create 时还要能建仓库
 * （经典的 repo scope，或细粒度 token 的 Administration: Read and write）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const API = 'https://api.github.com';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback = undefined) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};

const repoArg = value('repo');
const dryRun = flag('dry-run');
const create = flag('create');
const branch = value('branch', 'main');
const message = value('message', '精灵日签：首个版本');
const tokenFile = value('token-file');

if (!repoArg || !/^[^/\s]+\/[^/\s]+$/.test(repoArg)) {
  console.error('用法：node push-github.mjs --repo <owner>/<name> [--create] [--dry-run] [--branch main] [--message "..."] [--token-file <path>]');
  process.exit(2);
}

// ----------------------------------------------------------------- 收集文件

/** 这些目录/文件不进仓库。点开头的一次性脚本（.diff.mjs 之类）也别混进去，只留 .gitignore。 */
const SKIP_DIRS = new Set(['node_modules', '.cortico-src', '.git', '.tmp-zip']);
const SKIP_FILE = /^(?:\.(?!gitignore)[^/]*|.*\.log)$/;

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILE.test(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...collect(path));
    else if (stat.size < 40 * 1024 * 1024) out.push({ path, rel: relative(root, path).replaceAll('\\', '/'), size: stat.size });
  }
  return out;
}

const files = collect(root).sort((a, b) => a.rel.localeCompare(b.rel));
const totalKb = files.reduce((sum, file) => sum + file.size, 0) / 1024;

console.log(`准备上传 ${files.length} 个文件，共 ${totalKb.toFixed(1)} kB → ${repoArg}:${branch}`);
for (const file of files) {
  if (file.rel.endsWith('.png') || file.rel.endsWith('.zip') || file.rel.endsWith('.tgz')) {
    console.log(`  ${(file.size / 1024).toFixed(0).padStart(6)} kB  ${file.rel}`);
  }
}
console.log(`  （其余 ${files.length - files.filter((f) => /\.(png|zip|tgz)$/.test(f.rel)).length} 个文本文件略）`);

if (dryRun) {
  console.log('\ndry-run：没有发任何请求，也没有需要 token。');
  process.exit(0);
}

// ----------------------------------------------------------------- token

function readToken() {
  const candidates = [];
  if (tokenFile) candidates.push(tokenFile);
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  candidates.push(join(root, '.token'), 'E:\\DSH-PET\\.github-token');
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8').trim();
      if (raw) return raw.split(/\r?\n/)[0].trim();
    } catch {
      // 没有就试下一个
    }
  }
  return '';
}

const token = readToken();
if (!token) {
  console.error(`
✗ 没有找到 GitHub token。三条路任选：

1) 放一个文件（最省事，本目录 .token 已被 .gitignore 排除）：
     E:\\DSH-PET\\精灵日签\\.token     内容只有一行 token
2) 设环境变量 GITHUB_TOKEN
3) --token-file <某个文件的路径>

token 权限：目标仓库的 Contents: Read and write；如果用 --create，还要能建仓库。
细粒度 token 更安全：先手动在 GitHub 建好空仓库，再给它这一个仓库的 Contents 写权限。
`);
  process.exit(1);
}

// ----------------------------------------------------------------- API

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'omikuji-release',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data?.message ? `${data.message}${data.errors ? ` (${JSON.stringify(data.errors)})` : ''}` : text.slice(0, 200);
    throw new Error(`${method} ${path} → ${response.status} ${detail}`);
  }
  return data;
}

const [owner, name] = repoArg.split('/');

// 仓库不存在就建（--create），否则先确认它在
const existing = await api('GET', `/repos/${owner}/${name}`).catch((err) => {
  if (String(err.message).includes('404')) return null;
  throw err;
});
if (!existing) {
  if (!create) {
    console.error(`✗ ${repoArg} 不存在或无权访问。先手动建一个空仓库，或加 --create 让我建。`);
    process.exit(1);
  }
  const created = await api('POST', owner === (await api('GET', '/user')).login ? '/user/repos' : `/orgs/${owner}/repos`, {
    name,
    description: '精灵日签 · Coopanion / Cortico World 扩展：每天一张签',
    private: flag('private'),
    auto_init: false,
  });
  console.log(`✓ 建了仓库 ${created.full_name}（${created.private ? '私有' : '公开'}）`);
} else {
  console.log(`✓ 仓库已存在：${existing.full_name}（默认分支 ${existing.default_branch}）`);
}

// 已有提交的话要接在它后面，否则提交历史会被冲掉
const head = await api('GET', `/repos/${owner}/${name}/git/ref/heads/${branch}`).catch(() => null);
const parents = head ? [head.object.sha] : [];

console.log('↑ 上传文件…');
const tree = [];
for (const [index, file] of files.entries()) {
  const content = readFileSync(file.path).toString('base64');
  const blob = await api('POST', `/repos/${owner}/${name}/git/blobs`, { content, encoding: 'base64' });
  tree.push({ path: file.rel, mode: '100644', type: 'blob', sha: blob.sha });
  if ((index + 1) % 10 === 0 || index + 1 === files.length) process.stdout.write(`  ${index + 1}/${files.length}\r`);
}
process.stdout.write('\n');

const newTree = await api('POST', `/repos/${owner}/${name}/git/trees`, { tree });
const commit = await api('POST', `/repos/${owner}/${name}/git/commits`, {
  message,
  tree: newTree.sha,
  parents,
});
if (head) {
  await api('PATCH', `/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
} else {
  await api('POST', `/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
}

console.log(`
✓ 推完了
  仓库   https://github.com/${owner}/${name}
  提交   ${commit.sha.slice(0, 7)}  ${message}
  文件   ${files.length} 个
`);
