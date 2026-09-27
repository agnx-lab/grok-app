#!/usr/bin/env node
/**
 * 场景：Grok App 路径 A host-shim — 固定端口 loopback；拉起/复用 Grok.app；
 * 读 session-api.json 探活；health 带回 AGNX_SIDECAR_INSTANCE。
 *
 * 环境：GROK_APP_SHIM_PORT（默认 18799）、GROK_APP_HOME、GROK_APP_REPO_ROOT、
 *       GROK_APP_SESSION_DATA_MODE、AGNX_SIDECAR_INSTANCE
 *
 * 路由：GET /v1/health · POST /v1/open · GET /
 */
import { execFileSync, spawn } from "node:child_process";
import { access, constants as fsConstants, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.GROK_APP_REPO_ROOT || path.resolve(__dirname, "../..");
const port = Number(process.env.GROK_APP_SHIM_PORT || process.env.PORT || 18799) || 18799;
const instanceId = process.env.AGNX_SIDECAR_INSTANCE || "";
const sessionDataMode = process.env.GROK_APP_SESSION_DATA_MODE || "shared";
const embedMode = process.env.GROK_APP_EMBED_MODE || "external-host";

let lastOpenAt = 0;
let lastLaunchError = null;
let grokChildPid = null;

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function appDataRoots() {
  const roots = [];
  if (process.env.GROK_APP_HOME) {
    roots.push(process.env.GROK_APP_HOME);
  }
  const home = os.homedir();
  if (process.platform === "darwin") {
    roots.push(path.join(home, "Library/Application Support/com.grokapp.grok-app"));
    roots.push(path.join(home, "Library/Application Support/com.grokapp.desktop"));
  } else if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData/Roaming");
    roots.push(path.join(appdata, "grokapp", "grok-app"));
    roots.push(path.join(appdata, "grok-app"));
  } else {
    roots.push(path.join(home, ".grok-app"));
  }
  return [...new Set(roots.filter(Boolean))];
}

async function readSessionApiJson() {
  for (const root of appDataRoots()) {
    const filePath = path.join(root, "session-api.json");
    if (!(await pathExists(filePath))) {
      continue;
    }
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { filePath, root, ...parsed };
      }
    } catch {
      // try next
    }
  }
  return null;
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      url,
      { method: "GET", timeout: 5000, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json,
          });
        });
      },
    );
    req.on("error", () => resolve({ ok: false, status: 0, json: null }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, json: null });
    });
    req.end();
  });
}

async function probeUpstreamSessionApi(endpoint) {
  if (!endpoint?.url || !endpoint?.token) {
    return { reachable: false, connectLockBusy: null };
  }
  const url = String(endpoint.url).replace(/\/$/, "") + "/v1/health";
  const res = await httpGetJson(url, {
    Authorization: `Bearer ${endpoint.token}`,
    "x-grok-token": String(endpoint.token),
  });
  return {
    reachable: res.ok === true && res.json?.ok === true,
    connectLockBusy: res.json?.connectLockBusy === true,
    status: res.status,
  };
}

async function resolveLaunchTarget() {
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push({ kind: "app", path: "/Applications/Grok.app" });
    candidates.push({ kind: "app", path: path.join(os.homedir(), "Applications/Grok.app") });
  }
  candidates.push({ kind: "bin", path: path.join(os.homedir(), ".local/bin/grok-app") });
  candidates.push({
    kind: "bin",
    path: path.join(repoRoot, "src-tauri/target/release/grok-app"),
  });
  candidates.push({
    kind: "app",
    path: path.join(repoRoot, "src-tauri/target/release/bundle/macos/Grok.app"),
  });
  for (const item of candidates) {
    if (await pathExists(item.path)) {
      return item;
    }
  }
  return null;
}

async function openOrLaunchGrok() {
  const target = await resolveLaunchTarget();
  if (!target) {
    lastLaunchError =
      "未找到 Grok.app。请从 https://grok-app.com 或 GitHub Releases 安装。";
    return { ok: false, error: "grok_app_not_installed", message: lastLaunchError };
  }
  lastLaunchError = null;
  try {
    if (process.platform === "darwin") {
      if (target.kind === "app") {
        execFileSync("open", ["-a", target.path.endsWith("Grok.app") ? "Grok" : target.path], {
          stdio: "ignore",
        });
      } else {
        const child = spawn(target.path, [], {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            ...(process.env.GROK_APP_HOME ? { GROK_APP_HOME: process.env.GROK_APP_HOME } : {}),
          },
        });
        child.unref();
        grokChildPid = child.pid ?? null;
      }
      try {
        execFileSync("open", ["grok://"], { stdio: "ignore" });
      } catch {
        // deep link optional
      }
    } else {
      const child = spawn(target.path, [], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
        windowsHide: true,
      });
      child.unref();
      grokChildPid = child.pid ?? null;
    }
    lastOpenAt = Date.now();
    return { ok: true, launchTarget: target.path, grokChildPid };
  } catch (err) {
    lastLaunchError = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "open_failed", message: lastLaunchError, launchTarget: target.path };
  }
}

async function buildHealth() {
  const endpoint = await readSessionApiJson();
  const upstream = await probeUpstreamSessionApi(endpoint);
  const launchTarget = await resolveLaunchTarget();
  const grokInstalled = Boolean(launchTarget);
  const sessionApiReady = Boolean(endpoint?.url && endpoint?.token);
  const grokRunning = upstream.reachable === true || sessionApiReady;
  const ok = grokInstalled === true;
  return {
    ok,
    instanceId: instanceId || undefined,
    embedMode,
    sessionDataMode,
    grokInstalled,
    grokRunning,
    sessionApiReady,
    connectLockBusy: upstream.connectLockBusy,
    sessionApiUrl: endpoint?.url || null,
    sessionApiFile: endpoint?.filePath || null,
    sessionApiPid: typeof endpoint?.pid === "number" ? endpoint.pid : null,
    launchTarget: launchTarget?.path || null,
    lastOpenAt: lastOpenAt || null,
    lastLaunchError,
    grokChildPid,
    shimPid: process.pid,
    port,
    appDataRoots: appDataRoots(),
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && (url.pathname === "/v1/health" || url.pathname === "/health")) {
    const health = await buildHealth();
    sendJson(res, health.ok ? 200 : 503, health);
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/open") {
    const result = await openOrLaunchGrok();
    sendJson(res, result.ok ? 200 : 503, { ...result, instanceId: instanceId || undefined });
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/v1")) {
    sendJson(res, 200, {
      ok: true,
      service: "grok-app-host-shim",
      embedMode,
      endpoints: ["/v1/health", "/v1/open"],
      instanceId: instanceId || undefined,
    });
    return;
  }
  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.listen(port, "127.0.0.1", async () => {
  // 启动时尝试拉起 Grok（已在跑则 open 复用）
  const target = await resolveLaunchTarget();
  if (target) {
    void openOrLaunchGrok();
  }
  // eslint-disable-next-line no-console
  console.error(
    `[grok-app-host-shim] listening http://127.0.0.1:${port}/v1/health instance=${instanceId || "-"}`,
  );
});

server.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error(`[grok-app-host-shim] listen error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
