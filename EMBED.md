# Grok App · Agnx 嵌入说明

- **上游：** [RongleCat/grok-app](https://github.com/RongleCat/grok-app)（MIT；非官方 xAI 产品）
- **产品宪法：** 遵守 Agnx `skills/agnx-app/SKILL.md` **「禁止外置另开应用」** —— Tab 必须呈现上游 Workbench；**禁止**状态页 + 打开系统窗 / 外置 Grok.app 当交付。
- **合法嵌入模式（目标）：** `embedMode=node-acp-sidecar`（路径 B）
  - Port ACP / session → **Node sidecar**（loopback；合同对齐 session-api）
  - Vite UI → `host.guest.mount`（`guest.kind=web`），Tab 内整站
- **已废止（2026-09-28）：** `external-host` / host-shim 拉起 Grok.app / 「打开系统窗口」主路径（历史胶水待拆除或改造成 B）
- **禁止：** 整嵌 Tauri WebView 进 Electron Tab
- **默认关闭：** Remote IM、桌宠
- **共存：** 与 OpenMausBot / AstrBot / Agnx 编码流会话互不同步
- **活页：** Agnx monorepo `docs/sub-app/GrokApp子应用需求_grok-app-sub-app.md`

## 嵌页宿主能力缺口（路径 B · 待填）

外层 Guest mount 绿 ≠ 业务通。Port 后须扫描：选目录 / Ask 卡 / Reveal / 编辑器写盘等，写入处置表（Skill 第二刀）。

## Agnx 侧改动（相对上游）

| 路径 | 说明 |
| --- | --- |
| `.agnx/` | 胶水（须收敛为 Guest + sidecar；废止外开主路径） |
| `EMBED.md` / `README.agnx.md` | 本嵌入说明 |
