/**
 * Wizard Keyboard Builders
 *
 * Build inline keyboards for wizard flow steps.
 *
 * @module telegram/flows/keyboards
 */

import { InlineKeyboard } from 'grammy';
import {
  type ProjectWizardState,
  type TechCategory,
  type WizardStep,
  TECH_STACK_OPTIONS,
  TECH_CATEGORY_LABELS,
  CLOUD_SERVICES,
  getTechCategoryFromStep,
  getPreviousStep,
} from './types.js';

// ============================================================================
// Tech Stack Keyboards
// ============================================================================

/**
 * Build keyboard for a tech stack category
 */
export function buildTechStackKeyboard(
  state: ProjectWizardState,
  category: TechCategory
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const options = TECH_STACK_OPTIONS[category];
  const selected = state.techStack[category];

  // Add option buttons (2 per row)
  for (let i = 0; i < options.length; i += 2) {
    const row: { text: string; callback_data: string }[] = [];

    for (let j = i; j < Math.min(i + 2, options.length); j++) {
      const option = options[j];
      if (!option) continue;

      const isSelected = selected.includes(option.id);
      const checkmark = isSelected ? '✓ ' : '';

      row.push({
        text: `${checkmark}${option.label}`,
        callback_data: `wizard:tech:toggle:${category}:${option.id}`,
      });
    }

    keyboard.row(...row.map((r) => InlineKeyboard.text(r.text, r.callback_data)));
  }

  // Add navigation row
  const prevStep = getPreviousStep(state.step);
  keyboard.row();

  if (prevStep) {
    keyboard.text('← Back', `wizard:nav:back`);
  }

  keyboard.text('Next →', `wizard:nav:next`);

  return keyboard;
}

// ============================================================================
// Cloud Services Keyboard
// ============================================================================

/**
 * Build keyboard for cloud services selection
 */
export function buildCloudServicesKeyboard(state: ProjectWizardState): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Add cloud service toggle buttons
  for (const service of CLOUD_SERVICES) {
    const isSelected = state.cloudServices[service.id];
    const checkmark = isSelected ? '✓ ' : '';

    keyboard.text(`${checkmark}${service.label}`, `wizard:cloud:toggle:${service.id}`);
  }

  // Navigation row
  keyboard.row();
  keyboard.text('← Back', `wizard:nav:back`);
  keyboard.text('Skip', `wizard:nav:skip`);
  keyboard.text('Next →', `wizard:nav:next`);

  return keyboard;
}

// ============================================================================
// Confirmation Keyboard
// ============================================================================

/**
 * Build keyboard for confirmation step
 */
export function buildConfirmKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('✓ Create Project', `wizard:confirm:create`);
  keyboard.row();
  keyboard.text('← Edit', `wizard:nav:back`);
  keyboard.text('✗ Cancel', `wizard:confirm:cancel`);

  return keyboard;
}

// ============================================================================
// Cancel/Resume Keyboard
// ============================================================================

/**
 * Build keyboard for when wizard is already active
 */
export function buildResumeKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('Continue Existing', `wizard:resume:continue`);
  keyboard.text('Start New', `wizard:resume:new`);

  return keyboard;
}

// ============================================================================
// Main Keyboard Builder
// ============================================================================

/**
 * Build the appropriate keyboard for the current step
 */
export function buildStepKeyboard(state: ProjectWizardState): InlineKeyboard | null {
  const { step } = state;

  // Name step - no keyboard (text input)
  if (step === 'name') {
    return null;
  }

  // Tech stack steps
  const techCategory = getTechCategoryFromStep(step);
  if (techCategory) {
    return buildTechStackKeyboard(state, techCategory);
  }

  // Cloud services
  if (step === 'cloud_services') {
    return buildCloudServicesKeyboard(state);
  }

  // Build goal - no keyboard (text input)
  if (step === 'build_goal') {
    const keyboard = new InlineKeyboard();
    keyboard.text('← Back', `wizard:nav:back`);
    keyboard.text('Skip →', `wizard:nav:skip`);
    return keyboard;
  }

  // Confirmation
  if (step === 'confirm') {
    return buildConfirmKeyboard();
  }

  return null;
}

// ============================================================================
// Message Builders
// ============================================================================

/**
 * Build message text for the current step
 */
export function buildStepMessage(state: ProjectWizardState): string {
  const { step } = state;

  // Name step
  if (step === 'name') {
    return `📁 *New Project*\n\nEnter the name for your new project:`;
  }

  // Tech stack steps
  const techCategory = getTechCategoryFromStep(step);
  if (techCategory) {
    const categoryLabel = TECH_CATEGORY_LABELS[techCategory];
    const categoryIndex = ['frontend', 'backend', 'database', 'styling', 'testing'].indexOf(
      techCategory
    );
    const progress = `${categoryIndex + 1}/5`;

    // Show current selections if any
    const selections: string[] = [];
    if (state.techStack.frontend.length > 0 && techCategory !== 'frontend') {
      selections.push(`Frontend: ${formatSelections(state.techStack.frontend)}`);
    }
    if (state.techStack.backend.length > 0 && techCategory !== 'backend') {
      selections.push(`Backend: ${formatSelections(state.techStack.backend)}`);
    }
    if (state.techStack.database.length > 0 && techCategory !== 'database') {
      selections.push(`Database: ${formatSelections(state.techStack.database)}`);
    }
    if (state.techStack.styling.length > 0 && techCategory !== 'styling') {
      selections.push(`Styling: ${formatSelections(state.techStack.styling)}`);
    }
    if (state.techStack.testing.length > 0 && techCategory !== 'testing') {
      selections.push(`Testing: ${formatSelections(state.techStack.testing)}`);
    }

    let message = `📁 *${state.projectName}*\n\n`;
    message += `*Step 2: Tech Stack* (${progress})\n\n`;
    message += `Select your *${categoryLabel}*:`;

    if (selections.length > 0) {
      message += `\n\n_Selected:_\n${selections.join('\n')}`;
    }

    return message;
  }

  // Cloud services
  if (step === 'cloud_services') {
    let message = `📁 *${state.projectName}*\n\n`;
    message += `*Step 3: Cloud Services*\n\n`;
    message += `Which cloud services do you want to set up?`;
    return message;
  }

  // Build goal
  if (step === 'build_goal') {
    let message = `📁 *${state.projectName}*\n\n`;
    message += `*Step 4: Build Goal*\n\n`;
    message += `What would you like to build? Send a message describing your project goals.`;
    return message;
  }

  // Confirmation
  if (step === 'confirm') {
    return buildConfirmationMessage(state);
  }

  return '';
}

/**
 * Build the confirmation summary message
 */
export function buildConfirmationMessage(state: ProjectWizardState): string {
  const lines: string[] = [];

  lines.push(`📁 *${state.projectName}*\n`);
  lines.push(`*Step 5: Confirm Project*\n`);
  lines.push(`Review your project configuration:\n`);

  // Tech stack
  lines.push(`*Tech Stack:*`);
  if (state.techStack.frontend.length > 0) {
    lines.push(`├─ Frontend: ${formatSelections(state.techStack.frontend)}`);
  }
  if (state.techStack.backend.length > 0) {
    lines.push(`├─ Backend: ${formatSelections(state.techStack.backend)}`);
  }
  if (state.techStack.database.length > 0) {
    lines.push(`├─ Database: ${formatSelections(state.techStack.database)}`);
  }
  if (state.techStack.styling.length > 0) {
    lines.push(`├─ Styling: ${formatSelections(state.techStack.styling)}`);
  }
  if (state.techStack.testing.length > 0) {
    lines.push(`└─ Testing: ${formatSelections(state.techStack.testing)}`);
  }

  if (
    state.techStack.frontend.length === 0 &&
    state.techStack.backend.length === 0 &&
    state.techStack.database.length === 0 &&
    state.techStack.styling.length === 0 &&
    state.techStack.testing.length === 0
  ) {
    lines.push(`└─ _None selected_`);
  }

  // Cloud services
  lines.push('');
  lines.push(`*Cloud Services:*`);
  const cloudServices: string[] = [];
  if (state.cloudServices.github) cloudServices.push('GitHub');
  if (state.cloudServices.supabase) cloudServices.push('Supabase');
  if (state.cloudServices.vercel) cloudServices.push('Vercel');

  if (cloudServices.length > 0) {
    lines.push(`└─ ${cloudServices.join(', ')}`);
  } else {
    lines.push(`└─ _None selected_`);
  }

  // Build goal
  if (state.buildGoal) {
    lines.push('');
    lines.push(`*Build Goal:*`);
    lines.push(`└─ ${truncateText(state.buildGoal, 100)}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format array of selections for display
 */
function formatSelections(selections: string[]): string {
  if (selections.length === 0) return '_None_';
  if (selections.includes('none')) return '_None_';

  return selections
    .filter((s) => s !== 'none')
    .map((s) => {
      // Capitalize first letter
      return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
    })
    .join(', ');
}

/**
 * Truncate text to max length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
