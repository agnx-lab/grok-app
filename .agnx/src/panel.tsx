// 场景：Grok App 路径 A 状态面板 — ensure host-shim、展示健康、一键打开系统窗；禁止 iframe。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkspaceAppHostApi } from "@getagnx/app-sdk";
import {
  GROK_APP_CONFIG_KEY,
  GROK_APP_ENSURE_TOOL_REL,
  GROK_APP_HOME_URL,
  GROK_APP_ID,
  GROK_APP_INSTALL_URL,
} from "./constants";
import {
  grokAppConfigToEnsureArgs,
  loadGrokAppConfigFromHost,
  type GrokAppConfigDocument,
} from "./grok-app-config";
import { bindGrokAppHost, getBoundHost, requireBoundHost } from "./host-bind";
import {
  subscribeGrokAppRuntimeRestart,
  type GrokAppRuntimeRestartReason,
} from "./runtime-coordinator";

const RETAIN_REASON = "grok-app-open";

const styles = StyleSheet.create(
  (theme) => ({
    root: {
      flex: 1,
      alignSelf: "stretch",
      minHeight: 0,
      minWidth: 0,
      backgroundColor: "transparent",
      padding: theme.spacing[6],
      gap: theme.spacing[4],
    },
    title: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.lg,
      fontWeight: "600",
    },
    muted: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      lineHeight: 20,
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    statusCard: {
      borderRadius: theme.radii?.md ?? 10,
      padding: theme.spacing[4],
      gap: theme.spacing[2],
      backgroundColor: theme.colors.input,
    },
    statusOk: {
      color: theme.colors.statusSuccess || "#15803d",
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
    statusWarn: {
      color: theme.colors.statusWarning || theme.colors.statusDanger,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
    mono: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
  }),
  "grok-app-panel",
);

export function bindGrokAppPanelHost(host: WorkspaceAppHostApi): void {
  bindGrokAppHost(host);
}

type HealthSnapshot = {
  ok?: boolean;
  grokInstalled?: boolean;
  grokRunning?: boolean;
  sessionApiReady?: boolean;
  connectLockBusy?: boolean | null;
  sessionApiUrl?: string | null;
  launchTarget?: string | null;
  lastLaunchError?: string | null;
  port?: number;
  message?: string;
  error?: string;
  installUrl?: string;
};

function pickEnsurePayload(result: {
  resultJson?: unknown;
  stdout?: string;
}): Record<string, unknown> | null {
  const json = result.resultJson;
  if (json && typeof json === "object" && json !== null) {
    return json as Record<string, unknown>;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // continue
    }
  }
  return null;
}

function DetailChip({
  label,
  busy,
  disabled,
  tone,
  onPress,
  testID,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: "accent" | "default";
  onPress: () => void;
  testID?: string;
}): ReactElement | null {
  const Chip = getBoundHost()?.ui?.Chip;
  if (!Chip) {
    return null;
  }
  return (
    <Chip
      label={busy ? "…" : label}
      tone={tone ?? "default"}
      busy={busy}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={label}
    />
  );
}

export function GrokAppPanel(_props: {
  appId: string;
  panelId: string;
  entityId: string;
}): ReactElement {
  const retainCfgRef = useRef<GrokAppConfigDocument | null>(null);
  const [cfg, setCfg] = useState<GrokAppConfigDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options?: { forceRestart?: boolean }) => {
    const host = requireBoundHost();
    if (!host.tools?.run) {
      setError("需 Agnx 桌面端 host.tools.run（当前端不支持外置 Host）。");
      setHealth(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadGrokAppConfigFromHost(host.config);
      retainCfgRef.current = loaded;
      setCfg(loaded);
      const result = await host.tools.run({
        appId: GROK_APP_ID,
        tool: GROK_APP_ENSURE_TOOL_REL,
        args: grokAppConfigToEnsureArgs(loaded, {
          forceRestart: options?.forceRestart,
        }),
        timeoutMs: 120_000,
      });
      const payload = pickEnsurePayload(result) || {};
      if (payload.ok === true || result.ok) {
        // ensure 成功后读 shim health
        const port = typeof payload.port === "number" ? payload.port : loaded.port;
        let snap: HealthSnapshot = {
          ok: true,
          port,
          launchTarget:
            typeof payload.launchTarget === "string" ? payload.launchTarget : null,
          grokInstalled: true,
          sessionApiReady: payload.sessionApiReady === true,
          grokRunning: payload.grokRunning === true,
        };
        if (host.http?.fetchJson) {
          try {
            const h = (await host.http.fetchJson(`http://127.0.0.1:${port}/v1/health`, {
              method: "GET",
              timeoutMs: 5000,
            })) as HealthSnapshot;
            snap = { ...snap, ...h, port };
          } catch {
            // keep ensure snapshot
          }
        }
        setHealth(snap);
        if (payload.ok === false) {
          setError(
            typeof payload.message === "string"
              ? payload.message
              : typeof payload.error === "string"
                ? payload.error
                : "ensure 未就绪",
          );
        }
      } else {
        const message =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.error === "string"
              ? payload.error
              : result.stderr?.slice(0, 300) || "ensure 失败";
        setError(message);
        setHealth({
          ok: false,
          error: typeof payload.error === "string" ? payload.error : "ensure_failed",
          message,
          installUrl:
            typeof payload.installUrl === "string" ? payload.installUrl : GROK_APP_INSTALL_URL,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const openSystemWindow = useCallback(async () => {
    const host = requireBoundHost();
    if (!host.tools?.run) {
      setError("需 Agnx 桌面端才能打开系统窗口。");
      return;
    }
    setOpenBusy(true);
    setError(null);
    try {
      const loaded = cfg || (await loadGrokAppConfigFromHost(host.config));
      const result = await host.tools.run({
        appId: GROK_APP_ID,
        tool: GROK_APP_ENSURE_TOOL_REL,
        args: grokAppConfigToEnsureArgs(loaded, { open: true }),
        timeoutMs: 60_000,
      });
      const payload = pickEnsurePayload(result) || {};
      if (payload.ok === false) {
        setError(
          typeof payload.message === "string"
            ? payload.message
            : "打开 Grok 窗口失败。请确认已安装 Grok.app。",
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpenBusy(false);
    }
  }, [cfg, refresh]);

  useEffect(() => {
    const host = requireBoundHost();
    let cancelled = false;
    void (async () => {
      const loaded = await loadGrokAppConfigFromHost(host.config);
      if (cancelled) {
        return;
      }
      retainCfgRef.current = loaded;
      setCfg(loaded);
      host.background?.requestRetain?.({
        appId: GROK_APP_ID,
        active: true,
        reason: RETAIN_REASON,
      });
      await refresh();
    })();
    return () => {
      cancelled = true;
      const keep = retainCfgRef.current?.keepRunningInBackground !== false;
      host.background?.requestRetain?.({
        appId: GROK_APP_ID,
        active: keep,
        reason: RETAIN_REASON,
      });
    };
  }, [refresh]);

  useEffect(() => {
    const host = requireBoundHost();
    if (!host.config?.subscribe) {
      return;
    }
    return host.config.subscribe({
      scope: "app",
      appId: GROK_APP_ID,
      key: GROK_APP_CONFIG_KEY,
      emitCurrent: false,
      listener: () => {
        void loadGrokAppConfigFromHost(host.config).then((next) => {
          retainCfgRef.current = next;
          setCfg(next);
        });
      },
    });
  }, []);

  useEffect(() => {
    return subscribeGrokAppRuntimeRestart((_reason: GrokAppRuntimeRestartReason) => {
      void refresh({ forceRestart: true });
    });
  }, [refresh]);

  const installed = health?.grokInstalled !== false && health?.error !== "grok_app_not_installed";
  const statusLine = !health
    ? busy
      ? "正在检查…"
      : "尚未探测"
    : health.ok && health.grokRunning
      ? "Grok Host 在线"
      : health.ok && health.grokInstalled
        ? "已安装 · 等待 session-api（请打开系统窗并完成首次设置）"
        : "未就绪";

  return (
    <View style={styles.root} testID="grok-app-panel">
      <Text style={styles.title}>Grok App</Text>
      <Text style={styles.muted}>
        路径 A：完整 Workbench 在系统窗口运行。本 Tab 只做健康状态与一键打开，不嵌 Tauri / 不假装
        iframe 整站。
      </Text>

      <View style={styles.statusCard} testID="grok-app-status-card">
        <Text style={health?.ok ? styles.statusOk : styles.statusWarn}>{statusLine}</Text>
        <Text style={styles.mono}>
          embedMode={cfg?.embedMode ?? "external-host"} · shim :{cfg?.port ?? "—"} · session=
          {cfg?.sessionDataMode ?? "shared"}
        </Text>
        {health?.launchTarget ? (
          <Text style={styles.mono}>launch: {health.launchTarget}</Text>
        ) : null}
        {health?.sessionApiUrl ? (
          <Text style={styles.mono}>session-api: {health.sessionApiUrl}</Text>
        ) : (
          <Text style={styles.muted}>
            session-api：未检测到（需 Grok.app 在跑并写出 session-api.json）
          </Text>
        )}
        {health?.connectLockBusy ? (
          <Text style={styles.statusWarn}>connectLockBusy：会话通道忙，请稍候再试</Text>
        ) : null}
        {error ? <Text style={styles.statusWarn}>{error}</Text> : null}
      </View>

      <View style={styles.row}>
        <DetailChip
          label="打开系统窗口"
          tone="accent"
          busy={openBusy}
          onPress={() => {
            void openSystemWindow();
          }}
          testID="grok-app-open-window"
        />
        <DetailChip
          label="刷新状态"
          busy={busy}
          onPress={() => {
            void refresh();
          }}
          testID="grok-app-refresh"
        />
        <DetailChip
          label="强制重启 shim"
          onPress={() => {
            void refresh({ forceRestart: true });
          }}
          testID="grok-app-force-restart"
        />
      </View>

      {!installed ? (
        <View style={styles.statusCard} testID="grok-app-install-cta">
          <Text style={styles.statusWarn}>未检测到本机 Grok.app</Text>
          <Text style={styles.muted}>
            请安装桌面客户端后再点「打开系统窗口」。安装包：{GROK_APP_INSTALL_URL} · 官网：
            {GROK_APP_HOME_URL}
          </Text>
        </View>
      ) : null}

      <Text style={styles.muted}>
        Remote IM / 桌宠默认关闭。详情 → 配置可改 CLI 路径、GROK_APP_HOME、sessionDataMode。与
        OpenMausBot / AstrBot 会话互不同步。
      </Text>
    </View>
  );
}
