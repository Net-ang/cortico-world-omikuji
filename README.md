# 精灵日签

<img src="cortico-world-omikuji/assets/icon.png" width="128" align="right" alt="精灵日签">

给 Coopanion / Cortico 桌宠的 World 扩展：**每天一张签，同一天在同一台机器上永远是同一张。**

分数、档位、签号由代码算（种子 = 日期 + 这台机器的随机盐），措辞默认由桌宠自己写——只给它分数、档位和写作约束，句子是它说的。不联网、不要密钥、不花 token（切成内置文案模式连模型都不碰）。

## 装

包里没有依赖、不需要编译。**下载 → 解压 → 扩展页「从本地目录安装」→ 重启 Coopanion → 启用**。

- 现成压缩包：[`releases/精灵日签-0.1.3.zip`](releases/)，解压后填 `cortico-world-omikuji-0.1.3` 的完整路径
- 或者把 `cortico-world-omikuji/` 整个目录指给它

装完要**重启 Coopanion**（插件列表是启动时读的），然后在 World 列表里勾上「精灵日签」——是否默认启用由 bot 声明决定，扩展自己说了不算。

## 用

- World 页的「今日一签」：牌扣着，按「抽今天的签」翻开；下面横排七天，点哪天看哪天。
- 对话里问「今日气运」「测测我今天怎么样」，它取一次签、用自己的话答。
- 抽到凶只是纸面玩笑。「相信科学，仅供娱乐参考。」这句在面板牌面上，不会每句话都重复。

当前版本 **0.1.3**，带 `experimental` 标签：逻辑、界面、契约都在离线自检里过了（30 项测试 + 面板假 DOM 跑通），但还没在真的 Coopanion 实例里加载过。

---

# 工程说明

包本体在 `cortico-world-omikuji/`，发布产物在 `releases/`。下面这些是给自己维护用的。

## 一分钟上手

```powershell
# 只自检，不写盘（改完代码先跑这个）
node release.mjs 0.2.0 --dry-run

# 发一版：自检 → 升版本 → 补 CHANGELOG 标题 → 打包 → 记 sha256
node release.mjs 0.2.0 "摘掉 experimental，补截图与图标"

# 再做一份给群友的「解压即装」zip（说明文字来自 先读我-模板.txt）
node pack-zip.mjs 0.2.0

# 换了图标源图就重出一次：抠背景、裁紧、方图留边、量化成 256px
& E:\DSH-PET\.tmp-check\sd\py313\python.exe make-icon.py

# 真正发到 npm（--registry 不能省，见下面第 1 个坑）
cd cortico-world-omikuji
npm publish --registry=https://registry.npmjs.org/ --cache E:\DSH-PET\.npm-cache
```

`release.mjs` 自检不过就停住，不写版本号、不打包——免得没验过的包留在 `releases/` 里。

## 目录

```
精灵日签\
  README.md                  ← 本文件（新会话先读这个）
  简介.md                     ← 一句话 / 群里发 / 市场详情 / 英文 四版文案
  发布记录.md                 ← 每个版本的改动、产物、sha256、是否已发布
  release.mjs                ← 一次改版的全流程脚本
  pack-zip.mjs               ← 用 releases 里的 tgz 做「解压即装」的 zip
  先读我-模板.txt             ← 上面那个 zip 里的安装说明（{{version}} 由脚本替换）
  make-icon.py               ← 从源图抠背景、裁切、出 256px 图标
  鲸海少女抽取上上签.png       ← 图标源图（1234×1275，棋盘格是画进图里的）
  releases\                  ← tgz + 给群友的 zip + SHA256SUMS.txt
  cortico-world-omikuji\     ← 包本体（目录名保持 ASCII，就是 npm 包名）
    src\                     ← rng / daily / salt / wording / panel / config / world / definition / index
    data\signs.json          ← 签库：八档、签文、解语、宜忌、幸运色、意象、每档分寸
    dist\webui.js            ← 面板客户端，手写原生 ES module（不打包）
    dist\webui.css           ← 面板样式，只用宿主 CSS 变量
    assets\icon.png          ← 市场卡片头像（256×256 透明底，16.9 kB）
    test\                    ← 29 项 node:test
    tools\                   ← preview / describe / check-client / dom-smoke / copy-audit / release-check
    README.md                ← 设计、契约、命令
    PUBLISH.md               ← 发布手册与回滚
```

## 这个扩展是什么（交接笔记）

- **显示名**「精灵日签」；包名 `cortico-world-omikuji`；World id `omikuji`；`cortico.api: 6`。
- **种子** = 每天的**真随机盐**：只有**真抽签**（工具 / 面板「抽今天的签」）时才 `crypto.randomBytes` 现摇一个，落盘 `omikuji-days.json`，只留七天。读（系统前缀、打开面板、回看）**不产生随机**。
- **没抽过的日子 = 旧版那套**：那天没人抽签，事后回看它就用「日期 + 固定本机盐（`omikuji-salt.json`）」，与 0.1.3 算出来的一致；七天以外的日期同理。
- **两种措辞模式**：`wording: "pet"`（默认，桌宠按约束自己写，当天首次落盘、同日只认第一份）／`"builtin"`（签库成句，不花模型）。
- **面板「今日一签」**：牌扣着 →「抽今天的签」翻开 → 七天横排回看。只读，不产生新的随机（今天的盐由第一次读到签的那次请求生成）。
- **免责句**只在面板牌面上，回执里不带（回执每轮都进上下文，重复会变噪音）。
- **名字不绑形象**：文案用的意象是船/灯/雨/菜畦这类，不指向任何具体角色——用户家的桌宠可能是任何形象。
- **名字不绑形象**：文案用的意象是船/灯/雨/菜畦这类，不指向任何具体角色——用户家的桌宠可能是任何形象。

## 已知缺口

- **还没在真的 Coopanion 实例里装过**。验证只到：单元测试 29 项、干装载（manifest/配置/工具/面板）、假 DOM 跑真客户端、打包检查。所以 `cortico.tags` 里带 `experimental`。
- 没有 `screenshots`，没有 `icon`——市场详情页的图位是空的。
- 装一次跑通后：摘掉 `experimental`、补图，升 `0.2.0`。

## 环境上的三个坑

1. **registry**：`E:\DSH-PET\.npmrc` 与用户目录的 `.npmrc` 都指向 `registry.npmmirror.com`。`npm publish` 不加 `--registry=https://registry.npmjs.org/` 会发到镜像上，而扩展市场读的是 npmjs.org。所有 npm 命令还要带 `--cache E:\DSH-PET\.npm-cache`，否则会去写 `%LOCALAPPDATA%` 被拒。
2. **pnpm 在沙箱里跑不了**（要开 `AppData\Local\pnpm-store-operation-locks\all-stores.lock`，工作区外，拒访问）。装扩展请走桌宠扩展页的「从本地目录安装」，填 `E:\DSH-PET\精灵日签\cortico-world-omikuji` 的绝对路径；宿主自己会跑 pnpm 建链接。
3. **`node_modules/cortico` 是指向 `.cortico-src` 的 junction**，只为让 `tools/describe.ts` 这类离线自检工具能 import 框架的 TS（Node 不允许对 `node_modules` 里的文件做类型剥离）。**搬动包目录后必须重建**，否则自检工具会报找不到模块：

   ```powershell
   cd E:\DSH-PET\精灵日签\cortico-world-omikuji
   cmd /c rmdir node_modules\cortico
   New-Item -ItemType Junction -Path node_modules\cortico -Target (Join-Path (Get-Location) '.cortico-src')
   ```

   它只是开发工具链的东西，不进 `files`、不影响发布。干净的机器上想重建 `.cortico-src`：`Copy-Item node_modules\cortico .cortico-src -Recurse`（先删 junction，再复制真包）。

## 明细文档

| 想知道 | 看 |
|---|---|
| 设计怎么定的、契约细节、常用命令 | `cortico-world-omikuji\README.md` |
| 怎么发布、怎么回滚、发完补什么 | `cortico-world-omikuji\PUBLISH.md` |
| 每个版本改了什么、产物在哪 | `发布记录.md` |
