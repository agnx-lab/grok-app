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
  let sessionDataMode = "shared";
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
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push("/Applications/Grok.app/Contents/MacOS/grok-app");
    candidates.push("/Applications/Grok.app/Contents/MacOS/Grok");
    // bundle path used as open target
    candidates.push("/Applications/Grok.app");
    candidates.push(path.join(os.homedir(), "Applications/Grok.app/Contents/MacOS/grok-app"));
    candidates.push(path.join(os.homedir(), "Applications/Grok.app"));
  }
  candidates.push(path.join(os.homedir(), ".local/bin/grok-app"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/grok-app"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/grok-app.exe"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/bundle/macos/Grok.app/Contents/MacOS/grok-app"));
  candidates.push(path.join(repoRoot, "src-tauri/target/release/bundle/macos/Grok.app"));

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

function buildEnv(cfg, token, launchPath) {
  const distDir = resolveDistDir(cfg.repoRoot);
  const env = {
    GROK_MIRROR_HEADLESS: "1",
    GROK_MIRROR_NO_TUNNEL: "1",
    GROK_MIRROR_PORT: String(cfg.port),
    GROK_MIRROR_TOKEN: token,
    GROK_MIRROR_ALLOW_LAN: "0",
    GROK_APP_SESSION_DATA_MODE: cfg.sessionDataMode,
    GROK_APP_EMBED_MODE: "mirror-sidecar",
  };
  // Packaged .app 可走 embedded frontendDist；仓内 release 优先显式 dist
  if (!String(launchPath).includes(".app")) {
    env.GROK_MIRROR_DIST = distDir;
  } else if (path.join(cfg.repoRoot, "dist", "index.html")) {
    // 若本仓已 build dist，也注入，便于开发树覆盖
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
  if (!health.ok || health.json?.ok !== true) {
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

  if (cfg.supervised) {
    const reused = await tryReused(cfg, statePath, token, wantedFp);
    if (reused) {
      console.log(JSON.stringify({ ...reused, warnings, launchPath: spawnCmd }));
      return;
    }

    const env = buildEnv(cfg, token, launchPath);
    await writeState(statePath, {
      fingerprint: wantedFp,
      mirrorToken: token,
      port: cfg.port,
      launchPath: spawnCmd,
      embedMode: "mirror-sidecar",
      pending: true,
    });

    console.log(
      JSON.stringify({
        ok: true,
        reused: false,
        plan: {
          command: spawnCmd,
          args: [],
          cwd: cfg.repoRoot,
          env,
          fingerprint: wantedFp,
          healthUrl: healthUrl(cfg.port, token),
          port: cfg.port,
          launchMode: "packaged",
        },
        origin: guestOrigin(cfg.port, token),
        port: cfg.port,
        healthUrl: healthUrl(cfg.port, token),
        mirrorToken: token,
        embedMode: "mirror-sidecar",
        launchPath: spawnCmd,
        warnings,
        repoRoot: cfg.repoRoot,
      }),
    );
    return;
  }

  // 非 supervised：仅探活
  const reused = await tryReused(cfg, statePath, token, wantedFp);
  if (reused) {
    console.log(JSON.stringify({ ...reused, warnings }));
    return;
  }
  console.log(
    JSON.stringify({
      ok: false,
      error: "mirror_not_running",
      message: "Mirror 未运行。请打开 Grok App Tab（supervised ensure）拉起 Headless Host。",
      origin: guestOrigin(cfg.port, token),
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
