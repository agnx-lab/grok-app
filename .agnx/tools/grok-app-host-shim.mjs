#!/usr/bin/env node
/**
 * @deprecated 路径 A 遗留。路径 B 主 sidecar 为 Headless Grok Host（ensure-grok-app.mjs）。
 * 本文件不再由 ensure 启动；保留仅供对照，可删。
 */
console.error(
  JSON.stringify({
    ok: false,
    error: "deprecated_path_a_shim",
    message:
      "grok-app-host-shim 已废止。请使用 ensure-grok-app.mjs 拉起 Headless Mirror（路径 B）。",
  }),
);
process.exit(1);
