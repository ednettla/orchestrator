/**
 * Status Card Formatter
 *
 * Format project status for Telegram display.
 *
 * @module telegram/formatters/status
 */

import type { ProjectStatus, ProjectPhase, RequirementsSummary } from '../types.js';

// ============================================================================
// Types
// ============================================================================

interface ProjectDetails {
  name: string;
  path: string;
  alias?: string | undefined;
  techStack?: {
    frontend?: string | undefined;
    backend?: string | undefined;
    database?: string | undefined;
  };
  cloudServices?: {
    github?: string | undefined;
    supabase?: string | undefined;
    vercel?: string | undefined;
  };
}

// ============================================================================
// Status Card Formatter
// ============================================================================

/**
 * Format a full status card
 */
export function formatStatusCard(
  project: ProjectDetails,
  status: ProjectStatus,
  daemonRunning: boolean
): string {
  const lines = [
    `━━━ *${project.name}* ━━━`,
    '',
    `*Phase:* ${getPhaseDisplay(status.phase)}`,
    `*Daemon:* ${daemonRunning ? '🟢 Running' : '⚪ Stopped'}`,
    '',
    formatRequirementsSummary(status.requirements),
  ];

  if (status.lastActivity) {
    lines.push('');
    lines.push(`_Last: ${status.lastActivity}_`);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━');

  return lines.join('\n');
}

/**
 * Format a compact status line
 */
export function formatCompactStatus(
  projectName: string,
  phase: ProjectPhase,
  daemonRunning: boolean
): string {
  const phaseEmoji = getPhaseEmoji(phase);
  const daemonIcon = daemonRunning ? '🟢' : '⚪';

  return `${projectName}: ${phaseEmoji} ${phase} ${daemonIcon}`;
}

/**
 * Format requirements summary
 */
export function formatRequirementsSummary(requirements: RequirementsSummary): string {
  const lines = [
    '*Requirements:*',
    `  ⏳ Pending: ${requirements.pending}`,
    `  🔄 In Progress: ${requirements.inProgress}`,
    `  ✅ Completed: ${requirements.completed}`,
    `  ❌ Failed: ${requirements.failed}`,
  ];

  return lines.join('\n');
}

/**
 * Format requirements as a progress bar
 */
export function formatProgressBar(requirements: RequirementsSummary, width: number = 10): string {
  const total =
    requirements.pending +
    requirements.inProgress +
    requirements.completed +
    requirements.failed;

  if (total === 0) return '░'.repeat(width);

  const completedRatio = requirements.completed / total;
  const inProgressRatio = requirements.inProgress / total;
  const failedRatio = requirements.failed / total;

  const completedChars = Math.floor(completedRatio * width);
  const inProgressChars = Math.floor(inProgressRatio * width);
  const failedChars = Math.floor(failedRatio * width);
  const pendingChars = width - completedChars - inProgressChars - failedChars;

  return (
    '█'.repeat(completedChars) +
    '▓'.repeat(inProgressChars) +
    '░'.repeat(pendingChars) +
    '▒'.repeat(failedChars)
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get display text for phase
 */
function getPhaseDisplay(phase: ProjectPhase): string {
  return `${getPhaseEmoji(phase)} ${capitalizeFirst(phase)}`;
}

/**
 * Get emoji for project phase
 */
function getPhaseEmoji(phase: ProjectPhase): string {
  switch (phase) {
    case 'idle':
      return '⚪';
    case 'planning':
      return '📋';
    case 'architecting':
      return '🏗️';
    case 'coding':
      return '💻';
    case 'reviewing':
      return '🔍';
    case 'testing':
      return '🧪';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    default:
      return '❓';
  }
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
