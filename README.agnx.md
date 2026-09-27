# Agnx Sub App · Grok App

官方社区 [Grok App](https://github.com/RongleCat/grok-app)（MIT）的 Agnx 外置子应用薄壳（路径 A：外置 Host）。

## 嵌入模式

当前 **`external-host`**：Tab 为状态页；完整 Workbench 在系统窗 Grok.app。详见 [`EMBED.md`](./EMBED.md)。

## 前置

1. 安装 [Grok App](https://grok-app.com) 或 [GitHub Releases](https://github.com/RongleCat/grok-app/releases)（macOS：`/Applications/Grok.app`）
2. 本机 [Grok Build CLI](https://x.ai) `grok` ≥ 0.2.112（按上游要求）

## 构建胶水

```bash
cd .agnx && npm run build
```

## Tab 行为

打开 Tab → `ensure-grok-app.mjs --supervised` → daemon 起 host-shim（`:18799`）→ shim 拉起/复用 Grok → 读 `session-api.json` 探活 → 「打开系统窗口」深链。

活页：Agnx monorepo `docs/sub-app/GrokApp子应用需求_grok-app-sub-app.md`
