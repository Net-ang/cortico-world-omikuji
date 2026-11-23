# 发布手册

包已经准备好，缺的只是扣扳机这一步。谁跑都行——我、你、或让桌宠通过它的 shell 跑，命令一样。

## 一条命令

```powershell
cd E:\DSH-PET\精灵日签\cortico-world-omikuji
npm publish --registry=https://registry.npmjs.org/ --cache E:\DSH-PET\.npm-cache
```

**`--registry` 不能省。** 这台机器的两个 `.npmrc`（工作区与用户目录）都把源指到了 `registry.npmmirror.com`，不加这个参数会把包发到镜像上去；扩展市场读的是 npmjs.org，发错地方等于没发。

`--cache` 也不能省：不改缓存目录时 npm 会去写 `%LOCALAPPDATA%\npm-cache`，本机沙箱拒绝。

账号已登录（`net_ang`）。开了 2FA 的话加 `--otp=<六位码>`，或者干脆在你自己的终端里跑。

## 发完确认

```powershell
npm view cortico-world-omikuji version dist-tags --registry=https://registry.npmjs.org/ --cache E:\DSH-PET\.npm-cache
```

市场按 `keywords` 里的 `cortico-world` 收录，索引需要一段时间才刷新；刚发完在别人机器上搜不到是正常的。

## 自己先装一遍

```
扩展页 → 从本地目录安装 → E:\DSH-PET\精灵日签\cortico-world-omikuji
```

或者包已经上 npm 之后：扩展页搜 `cortico-world-omikuji` 直接装。装完**重启 Coopanion**（插件注入表是宿主启动时的快照），然后启用 `worlds.omikuji.enabled`（默认关）。

## 发出去之后该补的两件事

1. **摘掉 `experimental` 标签。** 现在带它是因为还没在真 Coopanion 里加载过。装一次、翻一次牌、问一句「今日气运」，跑通了就改 `cortico.tags` 为 `["companion"]`，发 0.2.0。
2. **补截图与图标。** 市场详情页现在图位是空的。面板翻开后截一张，放 `assets/`，在 `cortico` 里加 `screenshots` 与 `icon`（PNG/SVG，见 manifest 的 `ICON_TYPES`）。

## 回滚

发出去 72 小时内可以撤：

```powershell
npm unpublish cortico-world-omikuji@0.1.0 --registry=https://registry.npmjs.org/ --cache E:\DSH-PET\.npm-cache
```

版本号一经发布不能复用，撤了要重发就得换号（0.2.0）。

## 发布前已核对

- 包名可用（registry 404）
- `cortico.api: 6`，干装载通过
- `describe.json` 由框架导出器生成且与代码一致
- 标签 `companion` + `experimental` 与实时词表一致
- CHANGELOG 有 `## 0.1.0`
- `npm test` 29 项、`tsc --noEmit`、`check:client`、`smoke:panel` 18 项全过
- `npm pack` 19 个文件 / 25.5 kB，无本机路径、无密钥
