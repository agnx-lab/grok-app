#!/usr/bin/env node
/**
 * 场景：短跑 sidecar — 确保 Grok Headless Mirror 已起（路径 B · Tab 内 Guest）。
 * 用法：node .agnx/tools/ensure-grok-app.mjs [--work-dir <dataRoot>] [--port <n>]
 *       [--mirror-token <tok>] [--grok-cli-path <bin>] [--grok-app-home <dir>]
 *       [--session-data-mode shared|independent] [--supervised] [--force-restart]
 *
 * stdout：单行 JSON { ok, origin, port, reused?, pid?, plan?, warnings?, error? }
 * origin 形如 http://127.0.0.1:{port}/t/{token}/ （禁止外开 Grok.app 当交付）
 */
import { spawn } from "node:child_process";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const defaultPort = 18799;
const INSTALL_HINT =
  "未找到可启动的 Grok Host 二进制。请安装 https://github.com/RongleCat/grok-app/releases 的 Grok.app，或在本仓执行 pnpm build / pnpm tauri build 产出 release 二进制后再试。禁止用「打开系统窗口」交差。";

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || "";
  let port = defaultPort;
  let mirrorToken = "";
  let grokCliPath = "";
  let grokAppHome = "";
  // Guest Tab 自定义通道（DeepSeek 等）写在 agent-home；默认 independent，避免芯片被官方 Grok 目录盖住。
  let sessionDataMode = "independent";
  let forceRestart = false;
  let supervised = false;
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
    } else if ((arg === "--mirror-token" || arg === "--mirrorToken") && next) {
      mirrorToken = String(next).trim();
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
    } else if (arg === "--force-restart" || arg === "--forceRestart") {
      forceRestart = true;
    } else if (arg === "--supervised") {
      supervised = true;
    } else if (arg === "--open" || arg === "--embed-mode" || arg === "--embedMode") {
      // 路径 A 已废止：忽略外开 / external-host
      if (arg === "--embed-mode" || arg === "--embedMode") {
        i += 1;
      }
    } else if (
      arg === "--enable-remote-im" ||
      arg === "--enableRemoteIm" ||
      arg === "--enable-pet" ||
      arg === "--enablePet"
    ) {
      i += 1;
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
    mirrorToken,
    grokCliPath: grokCliPath || process.env.AGNX_GROK_CLI_PATH || "",
    grokAppHome: grokAppHome || process.env.GROK_APP_HOME || "",
    sessionDataMode,
    forceRestart,
    supervised,
    repoRoot,
  };
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
    // gone
  }
}

function guestOrigin(port, token) {
  return `http://127.0.0.1:${port}/t/${token}/`;
}

function healthUrl(port, token) {
  return `http://127.0.0.1:${port}/t/${token}/api/health`;
}

function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: "GET", timeout: timeoutMs }, (res) => {
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
          body,
        });
      });
    });
    req.on("error", () => resolve({ ok: false, status: 0, json: null, body: "" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, json: null, body: "" });
    });
    req.end();
  });
}

async function resolveLaunchBinary(repoRoot) {
  // 优先仓内 debug/release（含 Guest Mirror 的 providers.list），再回落系统安装包。
  const candidates = [];
  candidates.push(path.join(repoRoot, "src-tauri/target/debug/grok-app"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/grok-app"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/grok-app.exe"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/bundle/macos/Grok.app/Contents/MacOS/grok-app"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/bundle/macos/Grok.app"));
  if (process.platform === "darwin") {
    candidates.push("/Applications/Grok.app/Contents/MacOS/grok-app");
    candidates.push("/Applications/Grok.app/Contents/MacOS/Grok");
    candidates.push("/Applications/Grok.app");
    candidates.push(path.join(os.homedir(), "Applications/Grok.app/Contents/MacOS/grok-app"));
    candidates.push(path.join(os.homedir(), "Applications/Grok.app"));
  }
  candidates.push(path.join(os.homedir(), ".local/bin/grok-app"));

  for (const p of candidates) {
    if (await pathExists(p)) {
      return p;
    }
  }
  return null;
}

function resolveDistDir(repoRoot) {
  const dist = path.join(repoRoot, "dist");
  return dist;
}

function fingerprint(cfg, token) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        repoRoot: cfg.repoRoot,
        port: cfg.port,
        token,
        grokCliPath: cfg.grokCliPath,
        grokAppHome: cfg.grokAppHome,
        sessionDataMode: cfg.sessionDataMode,
        embed: "mirror-sidecar",
        // Path B Guest 必须可 session.send；fingerprint 变化会强制重启旧只读 Host
        mirrorReadOnly: false,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

async function resolveOrCreateToken(cfg, statePath) {
  if (cfg.mirrorToken) {
    return cfg.mirrorToken;
  }
  const existing = await readState(statePath);
  if (typeof existing?.mirrorToken === "string" && existing.mirrorToken.length >= 16) {
    return existing.mirrorToken;
  }
  return randomBytes(24).toString("hex");
}

async function buildEnv(cfg, token, launchPath) {
  const distDir = resolveDistDir(cfg.repoRoot);
  const distIndex = path.join(distDir, "index.html");
  const env = {
    GROK_MIRROR_HEADLESS: "1",
    GROK_MIRROR_NO_TUNNEL: "1",
    GROK_MIRROR_PORT: String(cfg.port),
    GROK_MIRROR_TOKEN: token,
    GROK_MIRROR_ALLOW_LAN: "0",
    // Tab Guest 是产品入口：必须允许 session.send / 权限 Ask，否则一发就
    // 「mirror is in read-only mode」。手机分享场景仍默认只读（env 未设）。
    GROK_MIRROR_READ_ONLY: "0",
    GROK_APP_SESSION_DATA_MODE: cfg.sessionDataMode,
    GROK_APP_EMBED_MODE: "mirror-sidecar",
  };
  // Packaged .app：勿注入缺失 dist（会盖掉 embedded frontend，落到 CI 占位路径）
  // 仓内 release / 本仓已 build：才显式 GROK_MIRROR_DIST
  const packaged = String(launchPath).includes(".app") || String(launchPath).includes("/Contents/MacOS/");
  if (!packaged || (await pathExists(distIndex))) {
    env.GROK_MIRROR_DIST = distDir;
  }
  if (cfg.grokAppHome) {
    env.GROK_APP_HOME = cfg.grokAppHome;
  }
  if (cfg.grokCliPath) {
    env.AGNX_GROK_CLI_PATH = cfg.grokCliPath;
  }
  return env;
}

async function waitForMirrorHealth(port, token, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const url = healthUrl(port, token);
  while (Date.now() < deadline) {
    const health = await httpGet(url, 2500);
    // Path B：ok 且可写（readOnly===false）。旧 Host 只回 {ok:true} 时无 readOnly 字段 → 视为未闭环，继续等新二进制。
    if (
      health.ok &&
      health.json?.ok === true &&
      health.json?.readOnly === false
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Grok Host health：`{ok:true, readOnly:false}`（Path B 写开）。
 * 无 instanceId → ensure 自拉起，并以 reused 交卷供 Guest 挂载。
 */
async function spawnMirrorLocal(cfg, statePath, token, wantedFp, launchPath, spawnCmd, warnings) {
  const envPatch = await buildEnv(cfg, token, launchPath);
  const existing = await readState(statePath);
  if (existing?.pid) {
    stopPid(existing.pid);
    await new Promise((r) => setTimeout(r, 400));
  }

  // --start-in-tray：藏主窗 + macOS Accessory（禁 Dock 独立窗当产品入口）
  const child = spawn(spawnCmd, ["--start-in-tray"], {
    cwd: cfg.repoRoot,
    env: { ...process.env, ...envPatch },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid ?? null;
  const ready = await waitForMirrorHealth(cfg.port, token, 120_000);
  if (!ready) {
    stopPid(pid);
    return {
      ok: false,
      error: "mirror_start_timeout",
      message: `Headless Mirror 启动超时（port=${cfg.port}）。${INSTALL_HINT}`,
      pid,
      warnings,
    };
  }
  await writeState(statePath, {
    fingerprint: wantedFp,
    mirrorToken: token,
    port: cfg.port,
    launchPath: spawnCmd,
    embedMode: "mirror-sidecar",
    pid,
    updatedAt: new Date().toISOString(),
  });
  return {
    ok: true,
    // 对 daemon supervised 路径：标 reused，避免再 spawn 并卡 instanceId 健康检查
    reused: true,
    port: cfg.port,
    origin: guestOrigin(cfg.port, token),
    healthUrl: healthUrl(cfg.port, token),
    mirrorToken: token,
    embedMode: "mirror-sidecar",
    pid,
    fingerprint: wantedFp,
    launchPath: spawnCmd,
    warnings: [
      ...warnings,
      "ensure 自拉起 Headless Host（Grok health 无 instanceId；非外开 UX）",
    ],
  };
}

function resolveCommand(launchPath) {
  if (launchPath.endsWith(".app")) {
    const macOs = path.join(launchPath, "Contents/MacOS");
    // Prefer known binary names inside bundle
    return {
      kind: "app-bundle",
      command: launchPath,
      // daemon will spawn; for .app we need the inner executable
      // Caller resolves inner path before buildPlan
    };
  }
  return { kind: "bin", command: launchPath };
}

async function resolveSpawnCommand(launchPath) {
  if (launchPath.endsWith(".app")) {
    const candidates = [
      path.join(launchPath, "Contents/MacOS/grok-app"),
      path.join(launchPath, "Contents/MacOS/Grok"),
    ];
    for (const c of candidates) {
      if (await pathExists(c)) {
        return c;
      }
    }
    // last resort: first executable in MacOS
    try {
      const { readdirSync } = await import("node:fs");
      const names = readdirSync(path.join(launchPath, "Contents/MacOS"));
      if (names[0]) {
        return path.join(launchPath, "Contents/MacOS", names[0]);
      }
    } catch {
      // fallthrough
    }
    return null;
  }
  return launchPath;
}

async function tryReused(cfg, statePath, token, wantedFp) {
  const existing = await readState(statePath);
  if (!existing?.pid || existing.fingerprint !== wantedFp) {
    return null;
  }
  try {
    process.kill(existing.pid, 0);
  } catch {
    return null;
  }
  const health = await httpGet(healthUrl(cfg.port, token));
  // 旧只读 Host 或旧 health 无 readOnly → 不 reuse，强制走 spawn 换写开二进制
  if (!health.ok || health.json?.ok !== true || health.json?.readOnly !== false) {
    return null;
  }
  return {
    ok: true,
    reused: true,
    pid: existing.pid,
    port: cfg.port,
    origin: guestOrigin(cfg.port, token),
    healthUrl: healthUrl(cfg.port, token),
    fingerprint: wantedFp,
    mirrorToken: token,
    embedMode: "mirror-sidecar",
  };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const warnings = [];
  await mkdir(cfg.workDir, { recursive: true });
  const statePath = path.join(cfg.workDir, "grok-app.json");
  const token = await resolveOrCreateToken(cfg, statePath);
  const wantedFp = fingerprint(cfg, token);

  if (cfg.forceRestart) {
    const existing = await readState(statePath);
    if (existing?.pid) {
      stopPid(existing.pid);
    }
  }

  const launchPath = await resolveLaunchBinary(cfg.repoRoot);
  if (!launchPath) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "grok_host_not_found",
        message: INSTALL_HINT,
        installUrl: "https://github.com/RongleCat/grok-app/releases",
        warnings: [INSTALL_HINT],
        repoRoot: cfg.repoRoot,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const spawnCmd = await resolveSpawnCommand(launchPath);
  if (!spawnCmd) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "grok_host_binary_unresolved",
        message: `无法解析 ${launchPath} 内可执行文件。${INSTALL_HINT}`,
        launchPath,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const distIndex = path.join(resolveDistDir(cfg.repoRoot), "index.html");
  if (!(await pathExists(distIndex)) && !String(launchPath).includes("/Applications/")) {
    warnings.push(
      `未找到 ${distIndex}。仓内 release 启动前请 pnpm build；已安装的 Grok.app 可走 embedded frontendDist。`,
    );
  }

  // 无论是否 supervised：先复用；否则 ensure 自拉起（Grok health 无 instanceId，
  // daemon 代 spawn 会卡死；无根 manifest 时还会落到非 supervised 探活失败）。
  const reused = await tryReused(cfg, statePath, token, wantedFp);
  if (reused) {
    console.log(
      JSON.stringify({
        ...reused,
        warnings,
        launchPath: spawnCmd,
        repoRoot: cfg.repoRoot,
      }),
    );
    return;
  }

  const started = await spawnMirrorLocal(
    cfg,
    statePath,
    token,
    wantedFp,
    launchPath,
    spawnCmd,
    warnings,
  );
  console.log(JSON.stringify({ ...started, repoRoot: cfg.repoRoot }));
  if (!started.ok) {
    process.exitCode = 1;
  }
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
