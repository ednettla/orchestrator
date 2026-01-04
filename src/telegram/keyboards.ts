/**
 * Telegram Inline Keyboards
 *
 * Keyboard builders for rich interactive UX.
 *
 * @module telegram/keyboards
 */

import { InlineKeyboard } from 'grammy';
import { createCallbackData } from './types.js';

// ============================================================================
// Project Actions
// ============================================================================

/**
 * Create project actions keyboard
 */
export function projectActionsKeyboard(projectName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Status', createCallbackData({ action: 'status', projectName }))
    .text('📋 Plan', createCallbackData({ action: 'plan', projectName }))
    .row()
    .text('▶️ Run', createCallbackData({ action: 'run', projectName }))
    .text('⏹ Stop', createCallbackData({ action: 'stop', projectName }))
    .row()
    .text('📝 Logs', createCallbackData({ action: 'logs', projectName }))
    .text('⚙️ Config', createCallbackData({ action: 'config', projectName }));
}

/**
 * Create project selection keyboard
 */
export function projectSelectionKeyboard(
  projects: Array<{ name: string; alias?: string | undefined }>
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (!project) continue;

    const label = project.alias ? `${project.name} (${project.alias})` : project.name;

    keyboard.text(label, createCallbackData({ action: 'select', projectName: project.name }));

    // Add row after every 2 projects
    if (i % 2 === 1 && i < projects.length - 1) {
      keyboard.row();
    }
  }

  return keyboard;
}

// ============================================================================
// Plan Approval
// ============================================================================

/**
 * Create plan approval keyboard
 */
export function planApprovalKeyboard(projectName: string, planId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Approve', createCallbackData({ action: 'approve', projectName, planId }))
    .text('❌ Reject', createCallbackData({ action: 'reject', projectName, planId }))
    .row()
    .text('📖 View Details', createCallbackData({ action: 'plan_details', projectName, planId }));
}

/**
 * Create plan confirmation keyboard (for plan command)
 */
export function planConfirmKeyboard(projectName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🚀 Start Planning', createCallbackData({ action: 'start_plan', projectName }))
    .text('❌ Cancel', createCallbackData({ action: 'cancel', projectName }));
}

// ============================================================================
// Run Control
// ============================================================================

/**
 * Create run confirmation keyboard
 */
export function runConfirmKeyboard(projectName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('▶️ Start', createCallbackData({ action: 'start_run', projectName }))
    .text('❌ Cancel', createCallbackData({ action: 'cancel', projectName }));
}

/**
 * Create stop confirmation keyboard
 */
export function stopConfirmKeyboard(projectName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⏹ Confirm Stop', createCallbackData({ action: 'confirm_stop', projectName }))
    .text('❌ Cancel', createCallbackData({ action: 'cancel', projectName }));
}

// ============================================================================
// Logs Navigation
// ============================================================================

/**
 * Create logs navigation keyboard
 */
export function logsNavigationKeyboard(
  projectName: string,
  options: {
    hasMore?: boolean;
    currentOffset?: number;
    linesPerPage?: number;
  }
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (options.hasMore) {
    const nextOffset = (options.currentOffset ?? 0) + (options.linesPerPage ?? 20);
    keyboard.text(
      '📜 More',
      createCallbackData({
        action: 'logs_more',
        projectName,
        extra: String(nextOffset),
      })
    );
  }

  keyboard.text('🔄 Refresh', createCallbackData({ action: 'logs_refresh', projectName }));

  return keyboard;
}

// ============================================================================
// Requirements
// ============================================================================

/**
 * Create requirements list keyboard
 */
export function requirementsListKeyboard(
  projectName: string,
  requirements: Array<{ id: string; title: string; status: string }>
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const req of requirements.slice(0, 5)) {
    const statusEmoji = getStatusEmoji(req.status);
    const label = `${statusEmoji} ${truncate(req.title, 30)}`;

    keyboard
      .text(label, createCallbackData({ action: 'req_details', projectName, requirementId: req.id }))
      .row();
  }

  if (requirements.length > 5) {
    keyboard.text(
      `... and ${requirements.length - 5} more`,
      createCallbackData({ action: 'req_all', projectName })
    );
  }

  return keyboard;
}

/**
 * Create requirement actions keyboard
 */
export function requirementActionsKeyboard(
  projectName: string,
  requirementId: string,
  status: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (status === 'pending') {
    keyboard
      .text('▶️ Run', createCallbackData({ action: 'run_req', projectName, requirementId }))
      .text('✏️ Edit', createCallbackData({ action: 'edit_req', projectName, requirementId }))
      .row();
  }

  if (status === 'failed') {
    keyboard.text('🔄 Retry', createCallbackData({ action: 'retry_req', projectName, requirementId }));
  }

  keyboard.text('🔙 Back', createCallbackData({ action: 'reqs', projectName }));

  return keyboard;
}

// ============================================================================
// Config & Settings
// ============================================================================

/**
 * Create config menu keyboard
 */
export function configMenuKeyboard(projectName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔧 Settings', createCallbackData({ action: 'config_settings', projectName }))
    .text('🔌 MCP', createCallbackData({ action: 'config_mcp', projectName }))
    .row()
    .text('🔐 Secrets', createCallbackData({ action: 'config_secrets', projectName }))
    .text('☁️ Cloud', createCallbackData({ action: 'config_cloud', projectName }));
}

// ============================================================================
// Confirmation Dialogs
// ============================================================================

/**
 * Create generic confirmation keyboard
 */
export function confirmationKeyboard(
  confirmAction: string,
  cancelAction: string,
  projectName?: string | undefined
): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm', createCallbackData({ action: confirmAction, projectName }))
    .text('❌ Cancel', createCallbackData({ action: cancelAction, projectName }));
}

/**
 * Create destructive action confirmation keyboard
 */
export function destructiveConfirmKeyboard(
  action: string,
  projectName: string,
  extraInfo?: string | undefined
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      '⚠️ Yes, I understand',
      createCallbackData({ action: `confirm_${action}`, projectName, extra: extraInfo })
    )
    .row()
    .text('❌ Cancel', createCallbackData({ action: 'cancel', projectName }));
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get status emoji
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'in_progress':
      return '🔄';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    default:
      return '❓';
  }
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
