# Grok App · Agnx 嵌入说明

- **上游：** [RongleCat/grok-app](https://github.com/RongleCat/grok-app)（MIT；非官方 xAI 产品）
- **嵌入模式（当前）：** `embedMode=external-host`（路径 A）
  - Supervised **Node host-shim**（默认 `127.0.0.1:18799`）拉起 / 复用本机 **Grok.app** 系统窗
  - Tab 内为 **状态 + 深链** 页，**不**嵌 Tauri、**不** `host.guest.mount` 整站
- **终态（未做）：** `node-acp-sidecar`（路径 B）— Port ACP + Vite Guest；见 Agnx 活页 W3–W4
- **数据：** `GROK_APP_HOME` 或 OS 默认（macOS：`~/Library/Application Support/com.grokapp.grok-app/`）
- **session-api：** Host 写 `{app_data}/session-api.json`；shim 读之探 `GET /v1/health`
- **默认关闭：** Remote IM、桌宠（`enableRemoteIm` / `enablePet` = false）
- **共存：** 与 OpenMausBot / AstrBot / Agnx 编码流会话互不同步；同机勿同时 YOLO 打同一 repo / 同一 grok 登录态
- **活页：** Agnx monorepo `docs/sub-app/GrokApp子应用需求_grok-app-sub-app.md`

## 嵌页宿主能力缺口（路径 A）

路径 A **不**嵌上游 Web UI，缺口表多为 N/A：

| 上游能力 | 处置 |
| --- | --- |
| 选目录 / 编辑器 / Ask 卡 | **D** — 在系统窗 Grok 内完成 |
| session-api 列表/续跑 | **A** — shim 健康 + Agent 极薄 tools（本期仅 health/open） |
| Remote IM / 桌宠 | **D** — 默认关 |

## Agnx 侧改动（相对上游）

| 路径 | 说明 |
| --- | --- |
| `.agnx/` | manifest / ensure / host-shim / 状态 panel / host.config / tools |
| `EMBED.md` / `README.agnx.md` | 本嵌入说明 |
