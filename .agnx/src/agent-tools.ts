// 场景：极薄 Agnx Agent 工具：grok_app_health / grok_app_open；不镜像 MCP / Skills。
import type { WorkspaceAppHostApi } from "@getagnx/app-sdk";
import {
  GROK_APP_ENSURE_TOOL_REL,
  GROK_APP_ID,
  GROK_APP_PANEL_ID,
} from "./constants";
import { grokAppConfigToEnsureArgs, loadGrokAppConfigFromHost } from "./grok-app-config";

const GROUP = {
  groupId: "grok-app",
  groupTitle: "Grok App",
} as const;

function pickEnsurePayload(result: {
  resultJson?: unknown;
  stdout?: string;
}): Record<string, unknown> | null {
  const json = result.resultJson;
  if (json && typeof json === "object" && json !== null) {
    return json as Record<string, unknown>;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // continue
    }
  }
  return null;
}

export function registerGrokAppAgentTools(host: WorkspaceAppHostApi): () => void {
  return host.registerAgentTools({
    appId: GROK_APP_ID,
    availability: "always",
    tools: [
      {
        name: "grok_app_health",
        ...GROUP,
        description:
          "检查 Grok App host-shim / session-api 是否就绪（必要时短跑 ensure）。不代替 Grok Workbench 内操作。",
        inputSchema: {
          type: "object",
          properties: {
            ensure: {
              type: "boolean",
              description: "为 true 时主动跑 ensure（默认 true）",
            },
          },
          additionalProperties: false,
        },
        execute: async (input) => {
          const ensure = input?.ensure !== false;
          if (!ensure) {
            return {
              ok: true,
              message: "未执行 ensure；请打开 Grok App Tab 或设 ensure:true。",
            };
          }
          if (!host.tools?.run) {
            return {
              ok: false,
              error: "host_tools_unavailable",
              message: "需 Agnx 桌面端 host.tools.run。",
            };
          }
          const cfg = await loadGrokAppConfigFromHost(host.config);
          const result = await host.tools.run({
            appId: GROK_APP_ID,
            tool: GROK_APP_ENSURE_TOOL_REL,
            args: grokAppConfigToEnsureArgs(cfg),
            timeoutMs: 120_000,
          });
          const payload = pickEnsurePayload(result);
          if (payload) {
            return payload;
          }
          return {
            ok: false,
            error: "empty_ensure_result",
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stderr: result.stderr?.slice(0, 400),
          };
        },
      },
      {
        name: "grok_app_open",
        ...GROUP,
        description:
          "打开 Grok App Tab，并请求在系统窗口打开 Grok Workbench（路径 A）。不把会话并入 Agnx conversation。",
        inputSchema: {
          type: "object",
          properties: {
            systemWindow: {
              type: "boolean",
              description: "为 true 时同时请求打开系统窗（默认 true）",
            },
          },
          additionalProperties: false,
        },
        execute: async (input) => {
          host.openMiniAppTab({
            appId: GROK_APP_ID,
            panelId: GROK_APP_PANEL_ID,
          });
          const wantOpen = input?.systemWindow !== false;
          if (!wantOpen || !host.tools?.run) {
            return {
              ok: true,
              appId: GROK_APP_ID,
              panelId: GROK_APP_PANEL_ID,
              message: "已请求打开 Grok App Tab。",
            };
          }
          const cfg = await loadGrokAppConfigFromHost(host.config);
          const result = await host.tools.run({
            appId: GROK_APP_ID,
            tool: GROK_APP_ENSURE_TOOL_REL,
            args: grokAppConfigToEnsureArgs(cfg, { open: true }),
            timeoutMs: 60_000,
          });
          const payload = pickEnsurePayload(result);
          return {
            ok: result.ok,
            appId: GROK_APP_ID,
            panelId: GROK_APP_PANEL_ID,
            systemWindow: payload || { ok: result.ok },
            message: "已请求打开 Tab 与系统窗口。",
          };
        },
      },
    ],
  });
}
