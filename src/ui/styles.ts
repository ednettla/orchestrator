/**
 * TUI Style Constants
 *
 * Centralized color and style definitions for the full-screen TUI.
 *
 * @module ui/styles
 */

export const colors = {
  // Primary accent colors
  primary: 'cyan',
  secondary: 'blue',
  accent: 'magenta',

  // Status colors
  success: 'green',
  warning: 'yellow',
  error: 'red',

  // Text colors
  text: 'white',
  muted: 'gray',
  highlight: 'cyan',

  // UI elements
  border: 'gray',
  selected: 'cyan',
  disabled: 'gray',
} as const;

export const icons = {
  // Navigation
  pointer: '\u276f', // ❯
  arrowUp: '\u2191', // ↑
  arrowDown: '\u2193', // ↓
  arrowLeft: '\u2190', // ←
  arrowRight: '\u2192', // →

  // Status
  success: '\u2713', // ✓
  error: '\u2717', // ✗
  warning: '\u26A0', // ⚠
  info: '\u2139', // ℹ
  pending: '\u25CB', // ○
  running: '\u25B6', // ▶
  retry: '\u21BB', // ↻

  // UI
  bullet: '\u2022', // •
  diamond: '\u25C6', // ◆
  square: '\u25A0', // ■
  circle: '\u25CF', // ●
  checkBox: '\u2610', // ☐
  checkBoxChecked: '\u2611', // ☑
} as const;

export const borders = {
  horizontal: '\u2500', // ─
  vertical: '\u2502', // │
  topLeft: '\u250C', // ┌
  topRight: '\u2510', // ┐
  bottomLeft: '\u2514', // └
  bottomRight: '\u2518', // ┘
  teeRight: '\u251C', // ├
  teeLeft: '\u2524', // ┤
  teeDown: '\u252C', // ┬
  teeUp: '\u2534', // ┴
  cross: '\u253C', // ┼
} as const;

export const spacing = {
  padding: 1,
  margin: 1,
  gap: 1,
} as const;

/**
 * Create a horizontal divider of the specified width
 */
export function createDivider(width: number): string {
  return borders.horizontal.repeat(width);
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format elapsed time in human-readable format
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
