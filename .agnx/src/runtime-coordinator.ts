// 场景：Grok App 运行时协调 — 配置变更后通知面板停旧再起。
export type GrokAppRuntimeRestartReason =
  | "port"
  | "grok-home"
  | "cli-path"
  | "session-mode"
  | "embed-mode"
  | "retain"
  | "manual";

type RestartListener = (reason: GrokAppRuntimeRestartReason) => void;

const listeners = new Set<RestartListener>();

export function subscribeGrokAppRuntimeRestart(listener: RestartListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyGrokAppRuntimeNeedsRestart(reason: GrokAppRuntimeRestartReason): void {
  for (const listener of listeners) {
    listener(reason);
  }
}
