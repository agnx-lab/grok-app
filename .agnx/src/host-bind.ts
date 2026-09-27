// 场景：Grok App Host 绑定单例 — 面板 / 详情 / tools 共用。
import type { WorkspaceAppHostApi } from "@getagnx/app-sdk";

let boundHost: WorkspaceAppHostApi | null = null;

export function bindGrokAppHost(host: WorkspaceAppHostApi): void {
  boundHost = host;
}

export function getBoundHost(): WorkspaceAppHostApi | null {
  return boundHost;
}

export function requireBoundHost(): WorkspaceAppHostApi {
  if (!boundHost) {
    throw new Error("Grok App Host 尚未绑定");
  }
  return boundHost;
}
