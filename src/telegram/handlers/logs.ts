/**
 * Logs Handler
 *
 * Handle logs command.
 *
 * @module telegram/handlers/logs
 */

import type { CommandContext, CommandResult } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { logsNavigationKeyboard } from '../keyboards.js';
import { getRecentLogs } from '../project-bridge.js';

/**
 * Handle logs command
 */
export async function logsHandler(ctx: CommandContext): Promise<CommandResult> {
  const { projectName, args } = ctx;

  if (!projectName) {
    return {
      success: false,
      response: 'Project name required.',
    };
  }

  const registry = getProjectRegistry();
  const project = registry.getProject(projectName);

  if (!project) {
    return {
      success: false,
      response: `Project not found: \`${projectName}\``,
      parseMode: 'Markdown',
    };
  }

  // Get line count from args
  const requestedLines = parseInt(args[0] ?? '20', 10);
  const lineCount = Math.min(Math.max(requestedLines, 5), 50);

  // Get recent logs
  const logs = await getRecentLogs(project.path, lineCount);

  if (logs.length === 0) {
    return {
      success: true,
      response:
        `📝 *No Logs*\n\n` +
        `Project: ${project.name}\n\n` +
        `No daemon logs found. Start a job with:\n` +
        `\`/${project.name} run\``,
      parseMode: 'Markdown',
    };
  }

  // Format logs
  const formattedLogs = logs.map((line) => formatLogLine(line));

  // Build response
  const lines = [
    `━━━ *${project.name} logs* ━━━`,
    '',
    '```',
    ...formattedLogs,
    '```',
    '',
    `_Showing last ${logs.length} lines_`,
  ];

  const keyboard = logsNavigationKeyboard(project.name, {
    hasMore: logs.length >= lineCount,
    currentOffset: 0,
    linesPerPage: lineCount,
  });

  return {
    success: true,
    response: lines.join('\n'),
    parseMode: 'Markdown',
    keyboard,
  };
}

/**
 * Format a log line for display
 */
function formatLogLine(line: string): string {
  // Parse timestamp and message
  const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);

  if (timestampMatch) {
    const timestamp = timestampMatch[1];
    const rest = line.slice(timestampMatch[0].length).trim();

    // Add emoji based on content
    let emoji = '';
    if (rest.includes('Error') || rest.includes('error') || rest.includes('FAIL')) {
      emoji = '❌ ';
    } else if (rest.includes('Warning') || rest.includes('warn')) {
      emoji = '⚠️ ';
    } else if (rest.includes('✓') || rest.includes('Success') || rest.includes('PASS')) {
      emoji = '✅ ';
    } else if (rest.includes('Planning') || rest.includes('Plan')) {
      emoji = '📋 ';
    } else if (rest.includes('Coding') || rest.includes('Writing')) {
      emoji = '💻 ';
    } else if (rest.includes('Review')) {
      emoji = '🔍 ';
    } else if (rest.includes('Test')) {
      emoji = '🧪 ';
    }

    return `[${timestamp}] ${emoji}${truncate(rest, 45)}`;
  }

  return truncate(line, 55);
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
