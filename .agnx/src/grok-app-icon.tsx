// 场景：Grok App 侧栏/命令图标 — Lucide 风格占位；有 manifest.icon 时宿主优先扫盘图。
import { createElement, type ReactElement } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export function GrokAppIcon(props: {
  size?: number;
  color?: string;
}): ReactElement {
  const size = props.size ?? 20;
  const color = props.color ?? "currentColor";
  return createElement(
    Svg,
    { width: size, height: size, viewBox: "0 0 24 24", fill: "none" },
    createElement(Rect, {
      x: 3,
      y: 4,
      width: 18,
      height: 14,
      rx: 2.5,
      stroke: color,
      strokeWidth: 1.6,
    }),
    createElement(Path, {
      d: "M7 18.5v1.5M17 18.5v1.5M9 22h6",
      stroke: color,
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
    createElement(Circle, { cx: 9, cy: 10, r: 1.2, fill: color }),
    createElement(Circle, { cx: 15, cy: 10, r: 1.2, fill: color }),
    createElement(Path, {
      d: "M9.5 13.5c.8.8 1.7 1.2 2.5 1.2s1.7-.4 2.5-1.2",
      stroke: color,
      strokeWidth: 1.4,
      strokeLinecap: "round",
    }),
  );
}
