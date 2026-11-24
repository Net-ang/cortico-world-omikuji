# 精灵日签

<img src="cortico-world-omikuji/assets/icon.png" width="128" align="right" alt="精灵日签">

作者 **奶糖_net** · npm [`cortico-world-omikuji`](https://www.npmjs.com/package/cortico-world-omikuji) · MIT

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
- **不抽就不给任何数**（0.4.4）：今天还没抽签时，快照里的 `sign` 是 `null`、七天横排今天那格没有分数，工具侧 `peek` 也不报数。抽签那一刻才定签，定签之前任何地方都不存在那天的数字。
- **第二天补录**（0.4.4）：挂载时与每 10 分钟巡检时，把七天窗口里「过去了却没记录」的日子用「日期 + 固定本机盐」定下来落盘（`source: "fallback"`），之后冻结——换配置里的盐也不再变；真抽过的（`source: "draw"`）一个字节不改；**今天永远不补**。补录出来的签与 0.1.3 口径逐字一致。
- **两种措辞模式**：`wording: "pet"`（默认，桌宠按约束自己写，当天首次落盘、同日只认第一份）／`"builtin"`（签库成句，不花模型）。
- **面板「今日一签」**：开屏就取快照（背景、头像、字体、日期、七天横排立刻在）；今天没抽时中间只摆扣着的牌，抽过之后才给牌面。
- **免责句**只在面板牌面上，回执里不带（回执每轮都进上下文，重复会变噪音）。
- **抽签前不报分数**（0.4.3）：分数只从工具回执出。系统前缀是静态的、挂载事件在没抽时只说「还没抽」、面板没抽时只摆扣着的牌并写「未抽」。因为前缀不会随抽签刷新，提前报分就会在上下文里留下两套说法。
- **每天没抽签会提醒**（0.4.3）：9 点之后仍未抽，每 10 分钟看一眼状态，一天提醒一次；提醒走 `piggyback`，不自己唤醒模型。
- **名字不绑形象**：文案用的意象是船/灯/雨/菜畦这类，不指向任何具体角色——用户家的桌宠可能是任何形象。

## 已知缺口

- **0.4.1 在真机上验过，挂了**：抽签动画、动态背景、头像三样都不出现。原因见下面第 5 条坑。`0.4.2` 修的就是它；0.4.2 已发到 npm/GitHub 并装进本机扩展目录，**等宿主重启**后跑 `tools/host-verify.ts` 复核。
- **0.4.3 未发布、已作废**：本地产物已删，内容并入 `0.4.4`（避免「同号不同内容」）。
- **0.4.4 已发布**（npm `10:13:48Z` + tag `v0.4.4` → `b96751e` + Release 资产 16,882,894 字节）：按 Linux 真机反馈修了「抽签前后签突变」「开屏空白」「record 热切换」「开机白跑一轮」，加了「今天没抽签会提醒」「更多…」收束弹窗，并把「不抽就不给任何数」做严格了、补上「第二天用固定盐补录」。逐条回复见 `反馈\回复-0.4.4.md`。
- **0.4.5 待发布**：字号整体大一倍（排版基准 14px → 28px，间距与头像一并换算成 em）。
- 没有 `screenshots`——市场详情页的图位还是空的（`icon` 已经有了）。
- 市集 catalog 还停在 `0.1.3`：`cortico-extensions` 的同步 Action 按计划跑，等它把最新版抓上去。
- 真机确认「动画会播、背景是那段 mp4、头像出来」之后：摘掉 `experimental`、补 `screenshots`，再升一号。

## 环境上的坑

1. **registry**：`E:\DSH-PET\.npmrc` 与用户目录的 `.npmrc` 都指向 `registry.npmmirror.com`。`npm publish` 不加 `--registry=https://registry.npmjs.org/` 会发到镜像上，而扩展市场读的是 npmjs.org。所有 npm 命令还要带 `--cache E:\DSH-PET\.npm-cache`，否则会去写 `%LOCALAPPDATA%` 被拒。
2. **pnpm 在沙箱里跑不了**（要开 `AppData\Local\pnpm-store-operation-locks\all-stores.lock`，工作区外，拒访问）。装扩展请走桌宠扩展页的「从本地目录安装」，填 `E:\DSH-PET\精灵日签\cortico-world-omikuji` 的绝对路径；宿主自己会跑 pnpm 建链接。
3. **`node_modules/cortico` 是指向 `.cortico-src` 的 junction**，只为让 `tools/describe.ts` 这类离线自检工具能 import 框架的 TS（Node 不允许对 `node_modules` 里的文件做类型剥离）。**搬动包目录后必须重建**，否则自检工具会报找不到模块：

   ```powershell
   cd E:\DSH-PET\精灵日签\cortico-world-omikuji
   cmd /c rmdir node_modules\cortico
   New-Item -ItemType Junction -Path node_modules\cortico -Target (Join-Path (Get-Location) '.cortico-src')
   ```

   它只是开发工具链的东西，不进 `files`、不影响发布。干净的机器上想重建 `.cortico-src`：`Copy-Item node_modules\cortico .cortico-src -Recurse`（先删 junction，再复制真包）。
5. **`WorldContext.packageDir` 是 bot 的包目录，不是本 World 的包目录**（框架原文：「bot 代码包目录，供包内模板与资产使用」）。照它拼 `assets/draw.mp4` 在自己机器上测不出来（自检工具显式传了正确目录），一装进真宿主就全灭：真机里它指向 fatfish 的包。**包内素材一律用 `import.meta.url` 反推**（见 `src/assets.ts` 的 `OWN_PACKAGE_DIR`），`ctx.packageDir` 只当兜底。签库 `data/signs.json` 一直是对的，因为它本来就走的 `import.meta.url`。
6. **系统前缀（和工具表）不是每轮重建的**：只有挂载/卸载 World、改可见性、手动「重载前缀」、重启才重建（`core.ts:693`、`core.ts:720`、`bot.ts:1105`）。所以 `envPromptVars()` 与 `tools()` 里**只能放不会变的东西**——把今天的分数或措辞模式写进去，抽签/改配置之后前缀里留的就是旧值，模型上下文会出现两套说法。`modulePrefixDrift()` 只用来提示「前缀已漂移」，没有任何地方凭它自动重建。同理，`tools()` 别按配置增删工具（改配置不会让工具表跟上）。
7. **PowerShell 5.1 + GitHub API 的三个连环坑**（发 0.4.1 时踩的，写 Release 用得上）：
   - `gh release create -d '{...}'` 这种带 JSON 的单引号参数会被 PowerShell 5.1 吃掉双引号，JSON 变废。**改成把 body 写进文件，用 `--data-binary @file` 提交**。
   - `Invoke-RestMethod` 的消息体里带中文会 422，纯 ASCII 就 200。同样的错在 Release 资产名上也存在：**资产 `name` 必须是 ASCII**，中文放进 `label`。
   - 别拿 PowerShell 的文本替换去改 UTF-8 源文件（会把中文写成乱码，`src/world.ts` 已经中过一次）；改文档用编辑器/写入工具，或 `[System.IO.File]::ReadAllText` + `WriteAllText` 并显式指定 UTF8。

## 明细文档

| 想知道 | 看 |
|---|---|
| 设计怎么定的、契约细节、常用命令 | `cortico-world-omikuji\README.md` |
| 怎么发布、怎么回滚、发完补什么 | `cortico-world-omikuji\PUBLISH.md` |
| 每个版本改了什么、产物在哪 | `发布记录.md` |

## 真机验收

装完之后在包目录下跑（只读，不改任何东西）：

```powershell
cd E:\DSH-PET\精灵日签\cortico-world-omikuji
node --experimental-transform-types tools/host-verify.ts
```

它查：扩展目录里声明的版本、`node_modules` 里实际装的版本、已安装包里的三个媒体素材、`src/assets.ts` 在不在，以及**本次进程日志**里还有没有「找不到素材」。最后一项只在宿主重启后才有意义——旧进程留下的记录不算数。
