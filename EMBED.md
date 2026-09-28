# Grok App · Agnx 嵌入说明

- **上游：** [RongleCat/grok-app](https://github.com/RongleCat/grok-app)（MIT；非官方 xAI 产品）
- **产品宪法：** 遵守 Agnx `skills/agnx-app/SKILL.md` **「禁止外置另开应用」**
- **当前嵌入模式：** `embedMode=mirror-sidecar`（路径 B）
  - **Headless Tauri Host**（`GROK_MIRROR_HEADLESS=1` + `GROK_MIRROR_NO_TUNNEL=1`）
  - Token 门控 Mirror：`http://127.0.0.1:{port}/t/{token}/`
  - Tab：`host.guest.mount`（`guest.auth=none`，path token 已鉴权），贴边满铺
  - ensure **自拉起** Host（Grok `/api/health` 仅 `{ok:true}`，无 `instanceId`；避免 daemon 代 spawn 卡死）
  - 启动参数 **`--start-in-tray`**：藏主窗 + macOS Accessory（禁止独立 Grok.app 窗口当入口）
  - **`GROK_MIRROR_READ_ONLY=0`**：Tab Guest 可 `session.send` / 权限 Ask（手机分享默认只读；嵌页必须写开）
  - 真树根目录须有 `manifest.json` → `.agnx/manifest.json`（daemon supervised 读根 manifest）
- **禁止：** 状态页 +「打开系统窗口」；`embedMode=external-host`；整嵌 Tauri WebView 壳
- **默认关闭：** Remote IM、桌宠、Quick Tunnel
- **前置：** 已安装 Grok.app（Releases）或本仓 `pnpm build` + `pnpm tauri build` 产出 release 二进制；本机 `grok` CLI ≥ 0.2.112
- **活页：** Agnx monorepo `docs/sub-app/GrokApp子应用需求_grok-app-sub-app.md`

## 嵌页宿主能力缺口（路径 B）

| 上游能力 | 嵌进 Agnx 后 | 处置 |
| --- | --- | --- |
| 会话列表/连接/发送/权限 Ask | Mirror WS RPC（`CMD_TO_METHOD`）；Host **须** `GROK_MIRROR_READ_ONLY=0` | **B** — 主验收路径 |
| 自定义通道模型切换（DeepSeek 等） | `providers.list/activate/upsert` + `composer.prefsSet`；Guest **勿** `isTauri()` 静默 return | **B** |
| 项目列表 / 基础 settings | Mirror 已映射 | **B** |
| 选目录 / 部分桌面-only `invoke` | 可能不可用 | **E/D** — 详情粘贴路径；标未完成勿假 PASS |
| 桌宠 / wallpaper / skin | 默认关 | **D** |
| Remote IM / 公网 Tunnel | 默认关（`NO_TUNNEL`） | **D** |
| Tauri 主窗 / Dock | sidecar 隐藏窗；Dock 可能见进程 | **D** — 非产品入口 |

## Agnx 侧改动（相对上游）

| 路径 | 说明 |
| --- | --- |
| `.agnx/` | manifest（guest）/ ensure Mirror / Guest panel / host.config / tools |
| `EMBED.md` / `README.agnx.md` | 本嵌入说明 |
| （历史）`grok-app-host-shim.mjs` | 路径 A 遗留；ensure 不再以它为主 sidecar |
