import type { Viewport, ViewTransform } from "./types.ts";
import { SPACE_SIZE } from "./style.ts";

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 8;

export function percentile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return Number.NaN;
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const left = sorted[low];
  const right = sorted[high];
  if (left === undefined || right === undefined) return Number.NaN;
  return left + (right - left) * (index - low);
}

/** Frame the 2nd–98th percentile so one outlier cannot shrink the main component. */
export function frameTransform(xs: readonly number[], ys: readonly number[], viewport: Viewport, space = SPACE_SIZE): ViewTransform | null {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  if (!points.length || viewport.width < 1 || viewport.height < 1) return null;
  const sx = points.map((point) => point.x).sort((a, b) => a - b);
  const sy = points.map((point) => point.y).sort((a, b) => a - b);
  const x0 = percentile(sx, 0.02);
  const x1 = percentile(sx, 0.98);
  const y0 = percentile(sy, 0.02);
  const y1 = percentile(sy, 0.98);
  const spanX = Math.max(1, x1 - x0);
  const spanY = Math.max(1, y1 - y0);
  const usableW = Math.max(1, viewport.width - viewport.insets.left - viewport.insets.right);
  const usableH = Math.max(1, viewport.height - viewport.insets.top - viewport.insets.bottom);
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(usableW / spanX, usableH / spanY) * 0.9));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const centerX = viewport.insets.left + usableW / 2;
  const centerY = viewport.insets.top + usableH / 2;
  return {
    k,
    x: centerX - k * (cx + (viewport.width - space) / 2),
    y: centerY - k * ((space - cy) + (viewport.height - space) / 2),
  };
}

export function focusZoom(current: number): number {
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, base * 4));
}
