// 场景：Grok App host.config — mirror-sidecar / CLI / HOME / sessionDataMode（禁 external-host）。
import type { WorkspaceAppConfigApi } from "@getagnx/app-sdk";
import {
  DEFAULT_GROK_APP_MIRROR_PORT,
  GROK_APP_CONFIG_KEY,
  GROK_APP_ID,
  type GrokAppEmbedMode,
  type GrokAppSessionDataMode,
} from "./constants";

export interface GrokAppConfigDocument {
  version: 1;
  embedMode: GrokAppEmbedMode;
  port: number;
  /** 可选固定 mirror token；空则 ensure 生成并落 state */
  mirrorToken: string;
  grokCliPath: string;
  grokAppHome: string;
  sessionDataMode: GrokAppSessionDataMode;
  enableRemoteIm: boolean;
  enablePet: boolean;
  keepRunningInBackground: boolean;
}

export function defaultGrokAppConfigDocument(): GrokAppConfigDocument {
  return {
    version: 1,
    embedMode: "mirror-sidecar",
    port: DEFAULT_GROK_APP_MIRROR_PORT,
    mirrorToken: "",
    grokCliPath: "",
    grokAppHome: "",
    // Guest / Mirror：自定义 provider 只活在 agent-home，默认 independent。
    sessionDataMode: "independent",
    enableRemoteIm: false,
    enablePet: false,
    keepRunningInBackground: true,
  };
}

function normalizeSessionDataMode(raw: unknown): GrokAppSessionDataMode {
  return raw === "independent" ? "independent" : "shared";
}

function normalizePort(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    return DEFAULT_GROK_APP_MIRROR_PORT;
  }
  return Math.floor(n);
}

export function normalizeGrokAppConfigDocument(raw: unknown): GrokAppConfigDocument {
  const defaults = defaultGrokAppConfigDocument();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const doc = raw as Partial<GrokAppConfigDocument> & { embedMode?: string };
  // 强制路径 B；历史 external-host / node-acp-sidecar 一律收敛
  return {
    version: 1,
    embedMode: "mirror-sidecar",
    port: normalizePort(doc.port),
    mirrorToken: typeof doc.mirrorToken === "string" ? doc.mirrorToken.trim() : "",
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
      | "port"
      | "mirrorToken"
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
  const normalized = normalizeGrokAppConfigDocument({
    ...current,
    ...patch,
    embedMode: "mirror-sidecar",
  });
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
  options?: { forceRestart?: boolean },
): string[] {
  const args = [
    "--port",
    String(cfg.port),
    "--session-data-mode",
    cfg.sessionDataMode,
  ];
  if (cfg.mirrorToken) {
    args.push("--mirror-token", cfg.mirrorToken);
  }
  if (cfg.grokCliPath) {
    args.push("--grok-cli-path", cfg.grokCliPath);
  }
  if (cfg.grokAppHome) {
    args.push("--grok-app-home", cfg.grokAppHome);
  }
  if (options?.forceRestart) {
    args.push("--force-restart");
  }
  return args;
}
