// 场景：详情「配置」— mirror port/token / CLI / HOME / sessionDataMode（禁外开）。
import { createElement, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import type { WorkspaceAppHostApi } from "@agnx-lab/app-sdk";
import {
  DEFAULT_GROK_APP_MIRROR_PORT,
  GROK_APP_ID,
  type GrokAppSessionDataMode,
} from "./constants";
import { getBoundHost } from "./host-bind";
import {
  defaultGrokAppConfigDocument,
  loadGrokAppConfigFromHost,
  saveGrokAppConfigToHost,
  type GrokAppConfigDocument,
} from "./grok-app-config";
import { notifyGrokAppRuntimeNeedsRestart } from "./runtime-coordinator";

let cachedConfig: GrokAppConfigDocument = defaultGrokAppConfigDocument();

export function getCachedGrokAppConfig(): GrokAppConfigDocument {
  return cachedConfig;
}

function setCachedGrokAppConfig(next: GrokAppConfigDocument): void {
  cachedConfig = next;
}

function useDetailLayoutStyles() {
  const { theme } = useUnistyles();
  const dark = theme.colorScheme !== "light";
  return useMemo(() => {
    const column: ViewStyle = {
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      alignSelf: "stretch",
      width: "100%",
      gap: 8,
      minWidth: 0,
    };
    const row: ViewStyle = {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
      minWidth: 0,
    };
    const muted: TextStyle = {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.foregroundMuted,
    };
    const ok: TextStyle = {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.statusSuccess || "#15803d",
    };
    const warn: TextStyle = {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.statusWarning || theme.colors.statusDanger,
    };
    const input = (focused: boolean): TextStyle => ({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 72,
      fontSize: 12,
      lineHeight: 16,
      borderWidth: 1.5,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      minHeight: 32,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      color: theme.colors.foreground,
      borderColor: focused
        ? theme.colors.accent
        : dark
          ? "rgba(255,255,255,0.35)"
          : "rgba(0,0,0,0.22)",
      backgroundColor: dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.92)",
    });
    return { column, row, muted, ok, warn, input };
  }, [dark, theme]);
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
  return createElement(Chip, {
    label: busy ? "…" : label,
    tone: tone ?? "default",
    busy,
    disabled: disabled || busy,
    onPress,
    testID,
    accessibilityLabel: label,
  });
}

function RuntimeDetailField(): ReactElement {
  const styles = useDetailLayoutStyles();
  const [portText, setPortText] = useState(String(cachedConfig.port));
  const [mirrorToken, setMirrorToken] = useState(cachedConfig.mirrorToken);
  const [grokCliPath, setGrokCliPath] = useState(cachedConfig.grokCliPath);
  const [grokAppHome, setGrokAppHome] = useState(cachedConfig.grokAppHome);
  const [sessionDataMode, setSessionDataMode] = useState<GrokAppSessionDataMode>(
    cachedConfig.sessionDataMode,
  );
  const [enableRemoteIm, setEnableRemoteIm] = useState(cachedConfig.enableRemoteIm);
  const [enablePet, setEnablePet] = useState(cachedConfig.enablePet);
  const [keepRunning, setKeepRunning] = useState(cachedConfig.keepRunningInBackground);
  const [portFocused, setPortFocused] = useState(false);
  const [tokenFocused, setTokenFocused] = useState(false);
  const [cliFocused, setCliFocused] = useState(false);
  const [homeFocused, setHomeFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const host = getBoundHost();
        if (!host) {
          return;
        }
        const loaded = await loadGrokAppConfigFromHost(host.config);
        if (cancelled) {
          return;
        }
        setCachedGrokAppConfig(loaded);
        setPortText(String(loaded.port));
        setMirrorToken(loaded.mirrorToken);
        setGrokCliPath(loaded.grokCliPath);
        setGrokAppHome(loaded.grokAppHome);
        setSessionDataMode(loaded.sessionDataMode);
        setEnableRemoteIm(loaded.enableRemoteIm);
        setEnablePet(loaded.enablePet);
        setKeepRunning(loaded.keepRunningInBackground);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = useCallback(async () => {
    const host = getBoundHost();
    if (!host) {
      return;
    }
    const port = Number(portText);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      setError(`端口无效（默认 ${DEFAULT_GROK_APP_MIRROR_PORT}）`);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    const before = cachedConfig;
    try {
      const saved = await saveGrokAppConfigToHost(host.config, {
        port: Math.floor(port),
        mirrorToken: mirrorToken.trim(),
        grokCliPath: grokCliPath.trim(),
        grokAppHome: grokAppHome.trim(),
        sessionDataMode,
        enableRemoteIm,
        enablePet,
        keepRunningInBackground: keepRunning,
      });
      setCachedGrokAppConfig(saved);
      const needRestart =
        saved.port !== before.port ||
        saved.mirrorToken !== before.mirrorToken ||
        saved.grokCliPath !== before.grokCliPath ||
        saved.grokAppHome !== before.grokAppHome ||
        saved.sessionDataMode !== before.sessionDataMode;
      if (needRestart) {
        notifyGrokAppRuntimeNeedsRestart(
          saved.port !== before.port
            ? "port"
            : saved.grokAppHome !== before.grokAppHome
              ? "grok-home"
              : saved.grokCliPath !== before.grokCliPath
                ? "cli-path"
                : "session-mode",
        );
        setSuccess("已保存；Mirror Host 正在按新配置热重启。");
      } else if (saved.keepRunningInBackground !== before.keepRunningInBackground) {
        notifyGrokAppRuntimeNeedsRestart("retain");
        setSuccess("已保存后台保持运行偏好（下次关 Tab 生效）。");
      } else {
        setSuccess("已保存。（Remote IM / 桌宠仅记录偏好，默认不启）");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    portText,
    mirrorToken,
    grokCliPath,
    grokAppHome,
    sessionDataMode,
    enableRemoteIm,
    enablePet,
    keepRunning,
  ]);

  return (
    <View style={styles.column} testID="grok-app-runtime-field">
      <Text style={styles.muted}>
        embedMode：mirror-sidecar（路径 B · Headless Mirror + Guest）。禁止外开系统窗。
      </Text>
      <Text style={styles.muted}>Mirror 端口（默认 {DEFAULT_GROK_APP_MIRROR_PORT}）</Text>
      <TextInput
        style={styles.input(portFocused)}
        value={portText}
        onChangeText={setPortText}
        onFocus={() => setPortFocused(true)}
        onBlur={() => setPortFocused(false)}
        keyboardType="number-pad"
        autoCapitalize="none"
        testID="grok-app-port-input"
      />
      <Text style={styles.muted}>Mirror token（可选；空 = ensure 自动生成）</Text>
      <TextInput
        style={styles.input(tokenFocused)}
        value={mirrorToken}
        onChangeText={setMirrorToken}
        onFocus={() => setTokenFocused(true)}
        onBlur={() => setTokenFocused(false)}
        placeholder="留空自动生成"
        placeholderTextColor={styles.muted.color}
        autoCapitalize="none"
        testID="grok-app-token-input"
      />
      <Text style={styles.muted}>grok CLI 路径（可选；空 = PATH）</Text>
      <TextInput
        style={styles.input(cliFocused)}
        value={grokCliPath}
        onChangeText={setGrokCliPath}
        onFocus={() => setCliFocused(true)}
        onBlur={() => setCliFocused(false)}
        placeholder="默认 PATH 上的 grok"
        placeholderTextColor={styles.muted.color}
        autoCapitalize="none"
        testID="grok-app-cli-input"
      />
      <Text style={styles.muted}>GROK_APP_HOME（可选）</Text>
      <TextInput
        style={styles.input(homeFocused)}
        value={grokAppHome}
        onChangeText={setGrokAppHome}
        onFocus={() => setHomeFocused(true)}
        onBlur={() => setHomeFocused(false)}
        placeholder="勿在 shared 模式乱改 ~/.grok"
        placeholderTextColor={styles.muted.color}
        autoCapitalize="none"
        testID="grok-app-home-input"
      />
      <View style={styles.row}>
        <DetailChip
          label={sessionDataMode === "shared" ? "● shared" : "shared"}
          tone={sessionDataMode === "shared" ? "accent" : "default"}
          onPress={() => setSessionDataMode("shared")}
          testID="grok-app-mode-shared"
        />
        <DetailChip
          label={sessionDataMode === "independent" ? "● independent" : "independent"}
          tone={sessionDataMode === "independent" ? "accent" : "default"}
          onPress={() => setSessionDataMode("independent")}
          testID="grok-app-mode-independent"
        />
        <DetailChip
          label={keepRunning ? "● 后台保持" : "后台保持"}
          tone={keepRunning ? "accent" : "default"}
          onPress={() => setKeepRunning((v) => !v)}
          testID="grok-app-keep-running"
        />
      </View>
      <View style={styles.row}>
        <DetailChip
          label={enableRemoteIm ? "● Remote IM" : "Remote IM"}
          tone={enableRemoteIm ? "accent" : "default"}
          onPress={() => setEnableRemoteIm((v) => !v)}
          testID="grok-app-remote-im"
        />
        <DetailChip
          label={enablePet ? "● 桌宠" : "桌宠"}
          tone={enablePet ? "accent" : "default"}
          onPress={() => setEnablePet((v) => !v)}
          testID="grok-app-pet"
        />
      </View>
      <View style={styles.row}>
        <DetailChip
          label="保存并应用"
          tone="accent"
          busy={busy}
          onPress={() => {
            void onSave();
          }}
          testID="grok-app-config-save"
        />
      </View>
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {success ? <Text style={styles.ok}>{success}</Text> : null}
    </View>
  );
}

function ReloadSection(): ReactElement {
  const styles = useDetailLayoutStyles();
  return (
    <View style={styles.row} testID="grok-app-reload">
      <DetailChip
        label="强制重启 Mirror"
        tone="accent"
        onPress={() => notifyGrokAppRuntimeNeedsRestart("manual")}
        testID="grok-app-force-restart-config"
      />
      <Text style={styles.muted}>整窗强刷用 ⌘⇧R</Text>
    </View>
  );
}

export function registerGrokAppDetailConfig(host: WorkspaceAppHostApi): () => void {
  if (!host.ui?.registerDetailSheetExtras) {
    return () => {};
  }
  void loadGrokAppConfigFromHost(host.config).then((loaded) => {
    setCachedGrokAppConfig(loaded);
  });
  return host.ui.registerDetailSheetExtras({
    appId: GROK_APP_ID,
    surface: "config",
    buildRows: () => {
      const cfg = getCachedGrokAppConfig();
      return [
        {
          label: "运行时",
          value: `mirror-sidecar · :${cfg.port} · ${cfg.sessionDataMode}`,
          helpText: "Mirror 端口 / token / CLI / GROK_APP_HOME / sessionDataMode。",
          groupId: "grok-app-runtime",
          groupTitle: "Grok App",
          valueContent: createElement(RuntimeDetailField),
        },
        {
          label: "重新加载",
          value: "Tab / Mirror",
          helpText: "强制重拉 ensure + Guest。",
          groupId: "grok-app-runtime",
          groupTitle: "Grok App",
          valueContent: createElement(ReloadSection),
        },
      ];
    },
  });
}
