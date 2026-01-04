/**
 * Logs Viewer Formatter
 *
 * Format log entries for Telegram display.
 *
 * @module telegram/formatters/logs
 */

// ============================================================================
// Types
// ============================================================================

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

// ============================================================================
// Logs Formatter
// ============================================================================

/**
 * Format logs for display
 */
export function formatLogs(
  projectName: string,
  logs: string[],
  options?: {
    offset?: number;
    showLineNumbers?: boolean;
  }
): string {
  const lines = [
    `━━━ *${projectName} logs* ━━━`,
    '',
    '```',
  ];

  const offset = options?.offset ?? 0;

  for (let i = 0; i < logs.length; i++) {
    const lineNumber = offset + i + 1;
    const formattedLine = formatLogLine(logs[i] ?? '');

    if (options?.showLineNumbers) {
      lines.push(`${lineNumber.toString().padStart(3)}: ${formattedLine}`);
    } else {
      lines.push(formattedLine);
    }
  }

  lines.push('```');
  lines.push('');
  lines.push(`_Showing ${logs.length} lines_`);

  return lines.join('\n');
}

/**
 * Format a single log line
 */
export function formatLogLine(line: string): string {
  // Truncate long lines
  const maxLength = 55;
  if (line.length > maxLength) {
    return line.slice(0, maxLength - 1) + '…';
  }
  return line;
}

/**
 * Parse a log line into structured format
 */
export function parseLogLine(line: string): LogEntry | null {
  // Try to match common log formats
  // [HH:MM:SS] Level: Message
  const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(\w+)?:?\s*(.*)$/);

  if (timestampMatch) {
    const levelStr = timestampMatch[2]?.toLowerCase() ?? 'info';
    let level: LogEntry['level'] = 'info';

    if (levelStr.includes('error') || levelStr.includes('fail')) {
      level = 'error';
    } else if (levelStr.includes('warn')) {
      level = 'warn';
    } else if (levelStr.includes('debug')) {
      level = 'debug';
    }

    return {
      timestamp: timestampMatch[1] ?? '',
      level,
      message: timestampMatch[3] ?? '',
    };
  }

  return null;
}

/**
 * Format log entries with highlighting
 */
export function formatLogEntries(entries: LogEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const emoji = getLogLevelEmoji(entry.level);
    lines.push(`[${entry.timestamp}] ${emoji} ${entry.message}`);
  }

  return lines.join('\n');
}

/**
 * Get emoji for log level
 */
function getLogLevelEmoji(level: LogEntry['level']): string {
  switch (level) {
    case 'error':
      return '❌';
    case 'warn':
      return '⚠️';
    case 'debug':
      return '🔧';
    case 'info':
    default:
      return '📝';
  }
}

/**
 * Filter logs by level
 */
export function filterLogsByLevel(
  logs: string[],
  minLevel: LogEntry['level']
): string[] {
  const levelOrder = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevelOrder = levelOrder[minLevel];

  return logs.filter((line) => {
    const entry = parseLogLine(line);
    if (!entry) return true; // Keep unparseable lines

    return levelOrder[entry.level] >= minLevelOrder;
  });
}

/**
 * Format logs summary
 */
export function formatLogsSummary(logs: string[]): string {
  let errors = 0;
  let warnings = 0;
  let total = logs.length;

  for (const line of logs) {
    const entry = parseLogLine(line);
    if (entry?.level === 'error') errors++;
    if (entry?.level === 'warn') warnings++;
  }

  const parts: string[] = [];

  if (errors > 0) {
    parts.push(`❌ ${errors} errors`);
  }
  if (warnings > 0) {
    parts.push(`⚠️ ${warnings} warnings`);
  }
  parts.push(`📝 ${total} total lines`);

  return parts.join(' • ');
}
