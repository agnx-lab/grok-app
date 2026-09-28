// 场景：Grok App Sub App 常量（AppId / 命令 / 面板 / ensure / 配置键）。
export const GROK_APP_ID = "grok-app";
export const GROK_APP_PANEL_ID = "grok-app.main";
export const GROK_APP_OPEN_COMMAND_ID = "grok-app.open";

/** 短跑 sidecar：Headless Mirror Host（路径 B）。 */
export const GROK_APP_ENSURE_TOOL_REL = ".agnx/tools/ensure-grok-app.mjs";

/** host.config app 级配置文档。 */
export const GROK_APP_CONFIG_KEY = "grok-app-config-v1";

export const DEFAULT_GROK_APP_MIRROR_PORT = 18799;

/** 唯一合法交付：mirror-sidecar（Headless Mirror + Guest）。 */
export type GrokAppEmbedMode = "mirror-sidecar";
export type GrokAppSessionDataMode = "shared" | "independent";

export const GROK_APP_INSTALL_URL = "https://github.com/RongleCat/grok-app/releases";
export const GROK_APP_HOME_URL = "https://grok-app.com";
