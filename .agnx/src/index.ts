// 场景：Grok App Sub App 入口 — Guest Mirror + ensure + 详情配置 + 极薄 tools（路径 B）。
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@getagnx/app-sdk";
import { GrokAppIcon } from "./grok-app-icon";
import {
  GROK_APP_ENSURE_TOOL_REL,
  GROK_APP_ID,
  GROK_APP_OPEN_COMMAND_ID,
  GROK_APP_PANEL_ID,
} from "./constants";
import { registerGrokAppAgentTools } from "./agent-tools";
import { registerGrokAppDetailConfig } from "./detail-config";
import { bindGrokAppPanelHost, GrokAppPanel } from "./panel";

export const appId = GROK_APP_ID;

function openGrokAppTab(
  host: WorkspaceAppHostApi,
  context?: {
    serverId?: string;
    workspaceId?: string;
    currentPathname?: string | null;
  },
): void {
  host.openMiniAppTab({
    appId: GROK_APP_ID,
    panelId: GROK_APP_PANEL_ID,
    serverId: context?.serverId,
    workspaceId: context?.workspaceId,
    currentPathname: context?.currentPathname,
  });
}

export function activate(host: WorkspaceAppHostApi): void {
  bindGrokAppPanelHost(host);
  registerGrokAppDetailConfig(host);
  registerGrokAppAgentTools(host);

  host.registerMiniApp({
    id: GROK_APP_PANEL_ID,
    appId: GROK_APP_ID,
    title: "Grok App",
    icon: GrokAppIcon,
    component: GrokAppPanel,
    iframeShortcutCapture: true,
    isolation: {
      mode: "iframe",
      sidecarTools: [GROK_APP_ENSURE_TOOL_REL],
      note: "路径 B：Headless Mirror + host.guest.mount；禁止外开 Grok.app",
    },
  });

  host.registerCommand({
    id: GROK_APP_OPEN_COMMAND_ID,
    appId: GROK_APP_ID,
    title: "Grok App",
    keywords: ["grok", "grok-app", "grokapp", "build cli", "workbench", "xai"],
    icon: GrokAppIcon,
    sidebarAction: {
      defaultVisible: true,
      label: "Grok",
      order: 62,
    },
    run: (context) => {
      openGrokAppTab(host, context);
    },
  });
}

const moduleExport: WorkspaceAppModule = {
  appId: GROK_APP_ID,
  activate,
};

export default moduleExport;

export {
  GROK_APP_ID,
  GROK_APP_OPEN_COMMAND_ID,
  GROK_APP_PANEL_ID,
} from "./constants";
export { GrokAppPanel } from "./panel";
