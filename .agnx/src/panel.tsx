// 场景：Grok App 路径 B 面板 — 只 host.guest.mount Headless Mirror；禁外开系统窗。
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  WorkspaceAppBrandLogoLoaderPanelProps,
  WorkspaceAppHostApi,
} from "@getagnx/app-sdk";
import {
  GROK_APP_CONFIG_KEY,
  GROK_APP_ENSURE_TOOL_REL,
  GROK_APP_ID,
} from "./constants";
import {
  grokAppConfigToEnsureArgs,
  loadGrokAppConfigFromHost,
} from "./grok-app-config";
import { bindGrokAppHost, requireBoundHost } from "./host-bind";
import {
  subscribeGrokAppRuntimeRestart,
  type GrokAppRuntimeRestartReason,
} from "./runtime-coordinator";

const WEB_ROOT_STYLE: CSSProperties = {
  flex: "1 1 0%",
  alignSelf: "stretch",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  backgroundColor: "transparent",
};

const GUEST_HOST_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const BOOT_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9, 9, 11)",
};

const ERROR_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  background: "rgba(9,9,11,0.88)",
};

const ERROR_FALLBACK_STYLE: CSSProperties = {
  ...ERROR_LAYER_STYLE,
  alignItems: "center",
  justifyContent: "center",
  color: "#a1a1aa",
  padding: 24,
  textAlign: "center",
};

const RETAIN_REASON = "grok-app-open";

const styles = StyleSheet.create(
  (theme) => ({
    fallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing[6],
      backgroundColor: "transparent",
    },
    fallbackText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      textAlign: "center",
    },
  }),
  "grok-app-panel",
);

export function bindGrokAppPanelHost(host: WorkspaceAppHostApi): void {
  bindGrokAppHost(host);
}

function getHost(): WorkspaceAppHostApi {
  return requireBoundHost();
}

function canUseGuestSurface(): boolean {
  return typeof document !== "undefined" && getHost().platform.isWeb;
}

export function GrokAppPanel(_props: {
  appId: string;
  panelId: string;
  entityId: string;
}): ReactElement {
  const guestHostRef = useRef<HTMLDivElement | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = getHost();
    let cancelled = false;
    void (async () => {
      const cfg = await loadGrokAppConfigFromHost(host.config);
      if (cancelled) {
        return;
      }
      host.background?.requestRetain?.({
        appId: GROK_APP_ID,
        active: true,
        reason: RETAIN_REASON,
      });
      void cfg;
    })();
    return () => {
      cancelled = true;
      void loadGrokAppConfigFromHost(host.config).then((cfg) => {
        const keep = cfg.keepRunningInBackground !== false;
        host.background?.requestRetain?.({
          appId: GROK_APP_ID,
          active: keep,
          reason: RETAIN_REASON,
        });
      });
    };
  }, []);

  useEffect(() => {
    if (!canUseGuestSurface()) {
      setBooting(false);
      setError("当前平台暂不支持嵌入 Grok App，请使用 Agnx 桌面端。");
      return;
    }

    let cancelled = false;
    let unmountGuest: (() => void) | null = null;
    let unsubscribeConfig: (() => void) | null = null;

    const mountGuest = async (options?: {
      forceRestart?: boolean;
      reason?: GrokAppRuntimeRestartReason;
    }) => {
      const host = getHost();
      if (!guestHostRef.current) {
        return;
      }
      if (!host.guest?.mount) {
        if (!cancelled) {
          setBooting(false);
          setError("宿主未提供 host.guest（需升级 Agnx 并重新扫描子应用）");
        }
        return;
      }

      unmountGuest?.();
      unmountGuest = null;
      setBooting(true);
      setError(null);

      try {
        const cfg = await loadGrokAppConfigFromHost(host.config);
        const args = grokAppConfigToEnsureArgs(cfg, {
          forceRestart: options?.forceRestart,
        });
        if (cancelled || !guestHostRef.current) {
          return;
        }
        unmountGuest = host.guest.mount({
          container: guestHostRef.current,
          ensureTool: GROK_APP_ENSURE_TOOL_REL,
          ensureArgs: args,
          timeoutMs: 300_000,
          bootOverlay: false,
          onReady: () => {
            if (!cancelled) {
              setError(null);
              window.setTimeout(() => {
                if (!cancelled) {
                  setBooting(false);
                }
              }, 320);
            }
          },
          onError: (detail) => {
            if (!cancelled) {
              setBooting(false);
              setError(`${detail.code}: ${detail.message}`);
            }
          },
        });
      } catch (err) {
        if (!cancelled) {
          setBooting(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void mountGuest();

    const unsubscribeRestart = subscribeGrokAppRuntimeRestart((reason) => {
      void mountGuest({ forceRestart: true, reason });
    });

    const hostForConfig = getHost();
    if (hostForConfig.config?.subscribe) {
      unsubscribeConfig = hostForConfig.config.subscribe({
        scope: "app",
        appId: GROK_APP_ID,
        key: GROK_APP_CONFIG_KEY,
        emitCurrent: false,
        listener: () => {
          void mountGuest({ forceRestart: true, reason: "manual" });
        },
      });
    }

    return () => {
      cancelled = true;
      unsubscribeRestart();
      unsubscribeConfig?.();
      unmountGuest?.();
    };
  }, []);

  if (!canUseGuestSurface()) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{error ?? "加载中…"}</Text>
      </View>
    );
  }

  const BrandPanel = getHost().ui
    ?.BrandLogoLoaderPanel as ComponentType<WorkspaceAppBrandLogoLoaderPanelProps> | undefined;

  return (
    <div style={WEB_ROOT_STYLE} data-testid="workspace-mini-app-grok-app-root">
      <div
        ref={guestHostRef}
        data-agnx-guest-surface-host="true"
        style={GUEST_HOST_STYLE}
      />
      {booting && !error && BrandPanel ? (
        <div data-agnx-guest-boot-overlay="true" style={BOOT_LAYER_STYLE} role="status">
          <BrandPanel title="正在启动 Grok App…" testID="grok-app-boot-overlay" />
        </div>
      ) : null}
      {booting && !error && !BrandPanel ? (
        <div data-agnx-guest-boot-overlay="true" style={ERROR_FALLBACK_STYLE} role="status">
          正在启动 Grok App…
        </div>
      ) : null}
      {error && BrandPanel ? (
        <div style={ERROR_LAYER_STYLE} role="alert">
          <BrandPanel
            title={error}
            description="打开命令面板 → Grok App → 详情，复制 Guest Surface。需已安装 Grok.app 或本仓 tauri build；禁止外开系统窗交差。"
            testID="grok-app-mount-error"
          />
        </div>
      ) : null}
      {error && !BrandPanel ? (
        <div style={ERROR_FALLBACK_STYLE} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
