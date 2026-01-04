/**
 * Plan Summary Formatter
 *
 * Format plan information for Telegram display.
 *
 * @module telegram/formatters/plan
 */

// ============================================================================
// Types
// ============================================================================

interface PlanPhase {
  name: string;
  description: string;
  requirements: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

interface PlanSummary {
  goal: string;
  phases: PlanPhase[];
  totalRequirements: number;
  estimatedPhases: number;
}

// ============================================================================
// Plan Formatter
// ============================================================================

/**
 * Format a plan for approval display
 */
export function formatPlanForApproval(
  projectName: string,
  plan: PlanSummary
): string {
  const lines = [
    `📋 *Plan Ready for Approval*`,
    '',
    `*Project:* ${projectName}`,
    `*Goal:* ${plan.goal}`,
    '',
    `*Phases:* ${plan.phases.length}`,
    `*Requirements:* ${plan.totalRequirements}`,
    '',
    '─────────────────',
    '',
  ];

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    if (!phase) continue;

    lines.push(`*${i + 1}. ${phase.name}*`);
    lines.push(`   _${phase.description}_`);

    if (phase.requirements.length > 0) {
      const reqs = phase.requirements.slice(0, 3);
      for (const req of reqs) {
        lines.push(`   • ${truncate(req, 40)}`);
      }
      if (phase.requirements.length > 3) {
        lines.push(`   _...and ${phase.requirements.length - 3} more_`);
      }
    }

    lines.push('');
  }

  lines.push('─────────────────');
  lines.push('');
  lines.push('_Review the plan and approve or reject._');

  return lines.join('\n');
}

/**
 * Format a plan progress card
 */
export function formatPlanProgress(
  projectName: string,
  plan: PlanSummary,
  currentPhaseIndex: number
): string {
  const lines = [
    `📊 *Plan Progress*`,
    '',
    `*Project:* ${projectName}`,
    `*Goal:* ${truncate(plan.goal, 50)}`,
    '',
  ];

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    if (!phase) continue;

    let statusIcon: string;
    if (i < currentPhaseIndex) {
      statusIcon = '✅';
    } else if (i === currentPhaseIndex) {
      statusIcon = '🔄';
    } else {
      statusIcon = '⏳';
    }

    lines.push(`${statusIcon} ${phase.name}`);
  }

  // Calculate overall progress
  const completed = plan.phases.filter((p) => p.status === 'completed').length;
  const progress = Math.round((completed / plan.phases.length) * 100);

  lines.push('');
  lines.push(`*Progress:* ${progress}%`);
  lines.push(formatProgressBar(progress, 10));

  return lines.join('\n');
}

/**
 * Format a compact plan summary
 */
export function formatCompactPlan(plan: PlanSummary): string {
  const phaseNames = plan.phases
    .slice(0, 3)
    .map((p) => p.name)
    .join(' → ');

  const more = plan.phases.length > 3 ? ` → ... (${plan.phases.length} total)` : '';

  return `📋 ${phaseNames}${more}`;
}

/**
 * Format plan requirements list
 */
export function formatPlanRequirements(phases: PlanPhase[]): string {
  const lines: string[] = [];

  for (const phase of phases) {
    lines.push(`*${phase.name}*`);

    for (const req of phase.requirements) {
      const statusIcon = getStatusIcon(phase.status);
      lines.push(`  ${statusIcon} ${truncate(req, 45)}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a progress bar
 */
function formatProgressBar(percentage: number, width: number = 10): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get status icon
 */
function getStatusIcon(status: PlanPhase['status']): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'in_progress':
      return '🔄';
    case 'failed':
      return '❌';
    case 'pending':
    default:
      return '⏳';
  }
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
