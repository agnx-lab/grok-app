#!/usr/bin/env node
/**
 * 场景：短跑 sidecar — 确保 Grok App host-shim 已起（路径 A · 外置 Host）。
 * 用法：node .agnx/tools/ensure-grok-app.mjs [--work-dir <dataRoot>] [--port <n>]
 *       [--grok-cli-path <bin>] [--grok-app-home <dir>] [--session-data-mode shared|independent]
 *       [--embed-mode external-host|node-acp-sidecar] [--enable-remote-im true|false]
 *       [--enable-pet true|false] [--supervised] [--force-restart] [--open]
 *
 * stdout：单行 JSON { ok, origin, reused?, pid?, plan?, warnings?, error? }
 *
 * --supervised：输出 daemon 可 spawn 的 plan（command=node host-shim）。
 * --open：在已有 shim 上 POST /v1/open，或直接拉起 Grok.app。
 */
import { execFile, execFileSync } from "node:child_process";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const shimScript = path.join(__dirname, "grok-app-host-shim.mjs");
const defaultPort = 18799;
const INSTALL_HINT =
  "未找到 Grok.app。请从 https://grok-app.com 或 https://github.com/RongleCat/grok-app/releases 安装后再试。";

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || "";
  let port = defaultPort;
  let grokCliPath = "";
  let grokAppHome = "";
  let sessionDataMode = "shared";
  let embedMode = "external-host";
  let enableRemoteIm = false;
  let enablePet = false;
  let forceRestart = false;
  let supervised = false;
  let openWindow = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--work-dir" || arg === "--workDir") && next) {
      workDir = String(next).trim();
      i += 1;
    } else if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) {
        port = Math.floor(n);
      }
      i += 1;
    } else if ((arg === "--grok-cli-path" || arg === "--grokCliPath") && next) {
      grokCliPath = String(next).trim();
      i += 1;
    } else if ((arg === "--grok-app-home" || arg === "--grokAppHome") && next) {
      grokAppHome = String(next).trim();
      i += 1;
    } else if ((arg === "--session-data-mode" || arg === "--sessionDataMode") && next) {
      sessionDataMode = next === "independent" ? "independent" : "shared";
      i += 1;
    } else if ((arg === "--embed-mode" || arg === "--embedMode") && next) {
      embedMode = next === "node-acp-sidecar" ? "node-acp-sidecar" : "external-host";
      i += 1;
    } else if ((arg === "--enable-remote-im" || arg === "--enableRemoteIm") && next) {
      enableRemoteIm = next === "true" || next === "1" || next === "yes";
      i += 1;
    } else if ((arg === "--enable-pet" || arg === "--enablePet") && next) {
      enablePet = next === "true" || next === "1" || next === "yes";
      i += 1;
    } else if (arg === "--force-restart" || arg === "--forceRestart") {
      forceRestart = true;
    } else if (arg === "--supervised") {
      supervised = true;
    } else if (arg === "--open") {
      openWindow = true;
    }
  }
  const resolvedWork =
    workDir ||
    path.join(
      process.env.AGNX_HOME || path.join(process.env.HOME || "", ".agnx-dev"),
      "apps",
      "data",
      "grok-app",
    );
  return {
    workDir: resolvedWork,
    port,
    grokCliPath: grokCliPath || process.env.AGNX_GROK_CLI_PATH || "",
    grokAppHome: grokAppHome || process.env.GROK_APP_HOME || "",
    sessionDataMode,
    embedMode,
    enableRemoteIm,
    enablePet,
    forceRestart,
    supervised,
    openWindow,
    repoRoot,
  };
}

function fingerprint(cfg) {
  return JSON.stringify({
    repoRoot: cfg.repoRoot,
    port: cfg.port,
    grokCliPath: cfg.grokCliPath,
    grokAppHome: cfg.grokAppHome,
    sessionDataMode: cfg.sessionDataMode,
    embedMode: cfg.embedMode,
    enableRemoteIm: cfg.enableRemoteIm,
    enablePet: cfg.enablePet,
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readState(statePath) {
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(statePath, payload) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function stopPid(pid) {
  if (!pid || !Number.isFinite(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

function healthUrlFor(cfg) {
  return `http://127.0.0.1:${cfg.port}/v1/health`;
}

function originFor(cfg) {
  return `http://127.0.0.1:${cfg.port}/`;
}

function httpJson(url, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      url,
      {
        method: options.method || "GET",
        timeout: options.timeoutMs || 4000,
        headers: options.headers || {},
      },
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
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, body });
        });
      },
    );
    req.on("error", () => resolve({ ok: false, status: 0, json: null, body: "" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, json: null, body: "" });
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/** 探测本机 Grok 二进制 / .app（不改 ~/.grok）。 */
async function resolveGrokLaunchTarget(cfg) {
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push({
      kind: "app-bundle",
      path: "/Applications/Grok.app",
      openCmd: ["open", ["-a", "Grok"]],
    });
    candidates.push({
      kind: "app-bundle",
      path: path.join(os.homedir(), "Applications/Grok.app"),
      openCmd: ["open", ["-a", "Grok"]],
    });
  }
  const localBin = path.join(os.homedir(), ".local/bin/grok-app");
  candidates.push({ kind: "bin", path: localBin });
  const releaseCandidates = [
    path.join(cfg.repoRoot, "src-tauri/target/release/grok-app"),
    path.join(cfg.repoRoot, "src-tauri/target/release/grok-app.exe"),
    path.join(cfg.repoRoot, "src-tauri/target/release/bundle/macos/Grok.app"),
  ];
  for (const p of releaseCandidates) {
    candidates.push({
      kind: p.endsWith(".app") ? "app-bundle" : "bin",
      path: p,
    });
  }

  for (const item of candidates) {
    if (await pathExists(item.path)) {
      return item;
    }
  }
  return null;
}

function defaultAppDataRoots(cfg) {
  const roots = [];
  if (cfg.grokAppHome) {
    roots.push(cfg.grokAppHome);
  }
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

async function tryReusedResponse(cfg, statePath, wantedFp) {
  const existing = await readState(statePath);
  if (!existing?.pid || existing.fingerprint !== wantedFp) {
    return null;
  }
  try {
    process.kill(existing.pid, 0);
  } catch {
    return null;
  }
  const health = await httpJson(healthUrlFor(cfg));
  if (!health.ok || health.json?.ok !== true) {
    return null;
  }
  return {
    ok: true,
    reused: true,
    pid: existing.pid,
    port: cfg.port,
    origin: originFor(cfg),
    healthUrl: healthUrlFor(cfg),
    fingerprint: wantedFp,
    launchTarget: existing.launchTarget || null,
    sessionApiReady: health.json?.sessionApiReady === true,
    grokRunning: health.json?.grokRunning === true,
  };
}

function buildShimEnv(cfg) {
  const env = {
    GROK_APP_SHIM_PORT: String(cfg.port),
    GROK_APP_REPO_ROOT: cfg.repoRoot,
    GROK_APP_SESSION_DATA_MODE: cfg.sessionDataMode,
    GROK_APP_EMBED_MODE: cfg.embedMode,
    GROK_APP_ENABLE_REMOTE_IM: cfg.enableRemoteIm ? "1" : "0",
    GROK_APP_ENABLE_PET: cfg.enablePet ? "1" : "0",
  };
  if (cfg.grokAppHome) {
    env.GROK_APP_HOME = cfg.grokAppHome;
  }
  if (cfg.grokCliPath) {
    env.AGNX_GROK_CLI_PATH = cfg.grokCliPath;
  }
  return env;
}

async function buildSupervisedPlan(cfg, warnings, wantedFp) {
  const launchTarget = await resolveGrokLaunchTarget(cfg);
  if (!launchTarget) {
    warnings.push(INSTALL_HINT);
    return {
      ok: false,
      error: "grok_app_not_installed",
      message: INSTALL_HINT,
      installUrl: "https://github.com/RongleCat/grok-app/releases",
    };
  }
  if (cfg.embedMode !== "external-host") {
    warnings.push("本期仅路径 A（external-host）；node-acp-sidecar 尚未落地，仍走外置 Host。");
  }
  if (!(await pathExists(shimScript))) {
    return { ok: false, error: "shim_missing", message: `找不到 ${shimScript}` };
  }
  return {
    ok: true,
    plan: {
      command: process.execPath,
      args: [shimScript],
      cwd: cfg.repoRoot,
      env: buildShimEnv(cfg),
      fingerprint: wantedFp,
      healthUrl: healthUrlFor(cfg),
      port: cfg.port,
      launchMode: "packaged",
    },
    launchTarget,
  };
}

async function openGrokWindow(cfg, launchTarget) {
  const target = launchTarget || (await resolveGrokLaunchTarget(cfg));
  if (!target) {
    return { ok: false, error: "grok_app_not_installed", message: INSTALL_HINT };
  }
  try {
    if (process.platform === "darwin") {
      if (target.kind === "app-bundle" && target.path.endsWith(".app")) {
        execFileSync("open", ["-a", target.path.includes("/Applications/") ? "Grok" : target.path], {
          stdio: "ignore",
        });
      } else {
        execFileSync("open", ["-a", "Grok"], { stdio: "ignore" });
      }
      // 尝试深链（若已注册 grok://）
      try {
        execFileSync("open", ["grok://"], { stdio: "ignore" });
      } catch {
        // optional
      }
    } else if (process.platform === "win32") {
      execFileSync(target.path, [], { stdio: "ignore", detached: true, windowsHide: true });
    } else {
      execFileSync(target.path, [], { stdio: "ignore", detached: true });
    }
    return { ok: true, opened: true, launchTarget: target.path };
  } catch (err) {
    return {
      ok: false,
      error: "open_failed",
      message: err instanceof Error ? err.message : String(err),
      launchTarget: target.path,
    };
  }
}

async function handleOpen(cfg, statePath, wantedFp) {
  const health = await httpJson(healthUrlFor(cfg));
  if (health.ok) {
    const opened = await httpJson(`http://127.0.0.1:${cfg.port}/v1/open`, {
      method: "POST",
      timeoutMs: 8000,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (opened.ok) {
      return {
        ok: true,
        opened: true,
        via: "shim",
        port: cfg.port,
        origin: originFor(cfg),
        ...(opened.json && typeof opened.json === "object" ? opened.json : {}),
      };
    }
  }
  const direct = await openGrokWindow(cfg, null);
  return { ...direct, via: "direct", fingerprint: wantedFp, statePath };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const warnings = [];
  await mkdir(cfg.workDir, { recursive: true });
  const statePath = path.join(cfg.workDir, "grok-app.json");
  const wantedFp = fingerprint(cfg);

  if (cfg.openWindow && !cfg.supervised) {
    const result = await handleOpen(cfg, statePath, wantedFp);
    console.log(JSON.stringify({ ...result, warnings, appDataRoots: defaultAppDataRoots(cfg) }));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (cfg.forceRestart) {
    const existing = await readState(statePath);
    if (existing?.pid) {
      stopPid(existing.pid);
    }
  }

  if (cfg.supervised) {
    const reused = await tryReusedResponse(cfg, statePath, wantedFp);
    if (reused) {
      if (cfg.openWindow) {
        const opened = await handleOpen(cfg, statePath, wantedFp);
        console.log(JSON.stringify({ ...reused, ...opened, warnings }));
        return;
      }
      console.log(JSON.stringify({ ...reused, warnings }));
      return;
    }
    const planned = await buildSupervisedPlan(cfg, warnings, wantedFp);
    if (!planned.ok) {
      console.log(
        JSON.stringify({
          ...planned,
          repoRoot: cfg.repoRoot,
          warnings,
          appDataRoots: defaultAppDataRoots(cfg),
        }),
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      JSON.stringify({
        ok: true,
        reused: false,
        plan: planned.plan,
        origin: originFor(cfg),
        port: cfg.port,
        healthUrl: healthUrlFor(cfg),
        launchTarget: planned.launchTarget?.path || null,
        warnings,
        repoRoot: cfg.repoRoot,
        openAfterStart: cfg.openWindow === true,
      }),
    );
    return;
  }

  // 非 supervised：仅探活 / 打开（不本地 spawn 长驻；长驻交给 daemon）
  const reused = await tryReusedResponse(cfg, statePath, wantedFp);
  if (reused) {
    console.log(JSON.stringify({ ...reused, warnings }));
    return;
  }
  const launchTarget = await resolveGrokLaunchTarget(cfg);
  if (!launchTarget) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "grok_app_not_installed",
        message: INSTALL_HINT,
        installUrl: "https://github.com/RongleCat/grok-app/releases",
        warnings: [INSTALL_HINT],
      }),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify({
      ok: false,
      error: "shim_not_running",
      message: "host-shim 未运行。请打开 Grok App Tab（走 supervised ensure）或传 --supervised。",
      launchTarget: launchTarget.path,
      warnings,
    }),
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exitCode = 1;
});
