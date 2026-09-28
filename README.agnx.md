# Agnx Sub App · Grok App

[Grok App](https://github.com/RongleCat/grok-app)（MIT）的 Agnx 外置子应用。

## 嵌入模式

**`mirror-sidecar`（路径 B）：** Tab 内 Guest 挂载 Headless Mirror Workbench。  
**禁止**外开独立 Grok.app 系统窗当交付。详见 [`EMBED.md`](./EMBED.md)。

## 前置

1. 安装 [Grok.app](https://github.com/RongleCat/grok-app/releases) **或** 本仓 `pnpm build && pnpm tauri build`
2. 本机 Grok Build CLI `grok` ≥ 0.2.112

## 构建胶水

```bash
cd .agnx && npm run build
```

## Tab 行为

打开 Tab → `ensure-grok-app.mjs --supervised` → daemon 起 Headless Grok Host（Mirror `:18799/t/{token}/`）→ `host.guest.mount`。

活页：Agnx monorepo `docs/sub-app/GrokApp子应用需求_grok-app-sub-app.md`
