// 场景：Grok App host.config — embedMode / CLI / HOME / sessionDataMode / RemoteIM·Pet 开关。
import type { WorkspaceAppConfigApi } from "@getagnx/app-sdk";
import {
  DEFAULT_GROK_APP_SHIM_PORT,
  GROK_APP_CONFIG_KEY,
  GROK_APP_ID,
  type GrokAppEmbedMode,
  type GrokAppSessionDataMode,
} from "./constants";

export interface GrokAppConfigDocument {
  version: 1;
  embedMode: GrokAppEmbedMode;
  port: number;
  grokCliPath: string;
  grokAppHome: string;
  sessionDataMode: GrokAppSessionDataMode;
  enableRemoteIm: boolean;
  enablePet: boolean;
  /** 关 Tab 后是否继续 requestRetain（后台自动化默认 true） */
  keepRunningInBackground: boolean;
}

export function defaultGrokAppConfigDocument(): GrokAppConfigDocument {
  return {
    version: 1,
    embedMode: "external-host",
    port: DEFAULT_GROK_APP_SHIM_PORT,
    grokCliPath: "",
    grokAppHome: "",
    sessionDataMode: "shared",
    enableRemoteIm: false,
    enablePet: false,
    keepRunningInBackground: true,
  };
}

function normalizeEmbedMode(raw: unknown): GrokAppEmbedMode {
  return raw === "node-acp-sidecar" ? "node-acp-sidecar" : "external-host";
}

function normalizeSessionDataMode(raw: unknown): GrokAppSessionDataMode {
  return raw === "independent" ? "independent" : "shared";
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    return DEFAULT_GROK_APP_SHIM_PORT;
  }
  return Math.floor(n);
}

export function normalizeGrokAppConfigDocument(raw: unknown): GrokAppConfigDocument {
  const defaults = defaultGrokAppConfigDocument();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const doc = raw as Partial<GrokAppConfigDocument>;
  return {
    version: 1,
    embedMode: normalizeEmbedMode(doc.embedMode),
    port: normalizePort(doc.port),
    grokCliPath: typeof doc.grokCliPath === "string" ? doc.grokCliPath.trim() : "",
    grokAppHome: typeof doc.grokAppHome === "string" ? doc.grokAppHome.trim() : "",
    sessionDataMode: normalizeSessionDataMode(doc.sessionDataMode),
    enableRemoteIm: doc.enableRemoteIm === true,
    enablePet: doc.enablePet === true,
    keepRunningInBackground: doc.keepRunningInBackground !== false,
  };
}

export async function loadGrokAppConfigFromHost(
  config: WorkspaceAppConfigApi | null | undefined,
): Promise<GrokAppConfigDocument> {
  if (!config?.get) {
    return defaultGrokAppConfigDocument();
  }
  try {
    const raw = await config.get({
      scope: "app",
      appId: GROK_APP_ID,
      key: GROK_APP_CONFIG_KEY,
      defaultValue: null,
    });
    return normalizeGrokAppConfigDocument(raw);
  } catch {
    return defaultGrokAppConfigDocument();
  }
}

export async function saveGrokAppConfigToHost(
  config: WorkspaceAppConfigApi | null | undefined,
  patch: Partial<
    Pick<
      GrokAppConfigDocument,
      | "embedMode"
      | "port"
      | "grokCliPath"
      | "grokAppHome"
      | "sessionDataMode"
      | "enableRemoteIm"
      | "enablePet"
      | "keepRunningInBackground"
    >
  >,
): Promise<GrokAppConfigDocument> {
  const current = await loadGrokAppConfigFromHost(config);
  const normalized = normalizeGrokAppConfigDocument({ ...current, ...patch });
  if (!config?.set) {
    return normalized;
  }
  await config.set({
    scope: "app",
    appId: GROK_APP_ID,
    key: GROK_APP_CONFIG_KEY,
    value: normalized,
  });
  return normalized;
}

/** 把 host.config 转成 ensure CLI 参数。 */
export function grokAppConfigToEnsureArgs(
  cfg: GrokAppConfigDocument,
  options?: { forceRestart?: boolean; open?: boolean },
): string[] {
  const args = [
    "--port",
    String(cfg.port),
    "--embed-mode",
    "external-host",
    "--session-data-mode",
    cfg.sessionDataMode,
    "--enable-remote-im",
    cfg.enableRemoteIm ? "true" : "false",
    "--enable-pet",
    cfg.enablePet ? "true" : "false",
  ];
  if (cfg.grokCliPath) {
    args.push("--grok-cli-path", cfg.grokCliPath);
  }
  if (cfg.grokAppHome) {
    args.push("--grok-app-home", cfg.grokAppHome);
  }
  if (options?.forceRestart) {
    args.push("--force-restart");
  }
  if (options?.open) {
    args.push("--open");
  }
  return args;
}
