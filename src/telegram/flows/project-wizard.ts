/**
 * Project Creation Wizard
 *
 * Interactive flow for creating new projects via Telegram.
 *
 * @module telegram/flows/project-wizard
 */

import type { Context } from 'grammy';
import { getGlobalStore } from '../../core/global-store.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { createStore } from '../../state/store.js';
import { DEFAULT_TECH_STACK, type TechStack } from '../../core/types.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type ProjectWizardState,
  type TechCategory,
  type CloudServiceId,
  createInitialWizardState,
  getNextStep,
  getPreviousStep,
  getTechCategoryFromStep,
} from './types.js';
import {
  buildStepKeyboard,
  buildStepMessage,
  buildResumeKeyboard,
} from './keyboards.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// State Management
// ============================================================================

const WIZARD_STATE_TYPE = 'project_wizard';
const WIZARD_TIMEOUT_HOURS = 0.5; // 30 minutes

/**
 * Get wizard state for a user
 */
function getWizardState(telegramId: number): ProjectWizardState | null {
  const store = getGlobalStore();
  const state = store.getConversationState(telegramId);

  if (!state || state.pendingConfirmationType !== WIZARD_STATE_TYPE) {
    return null;
  }

  return state.pendingConfirmationData as ProjectWizardState | null;
}

/**
 * Save wizard state for a user
 */
function saveWizardState(telegramId: number, wizardState: ProjectWizardState): void {
  const store = getGlobalStore();
  const existingState = store.getConversationState(telegramId);

  store.setConversationState(telegramId, {
    activeProject: existingState?.activeProject ?? null,
    pendingConfirmationType: WIZARD_STATE_TYPE,
    pendingConfirmationData: wizardState as unknown as Record<string, unknown>,
    expiresInHours: WIZARD_TIMEOUT_HOURS,
  });
}

/**
 * Clear wizard state for a user
 */
function clearWizardState(telegramId: number): void {
  const store = getGlobalStore();
  store.clearPendingConfirmation(telegramId);
}

// ============================================================================
// Wizard Entry Point
// ============================================================================

/**
 * Start the project creation wizard
 */
export async function startProjectWizard(
  ctx: Context,
  projectName?: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Check if wizard is already active
  const existingState = getWizardState(telegramId);
  if (existingState) {
    // Ask if they want to continue or start new
    const keyboard = buildResumeKeyboard();
    await ctx.reply(
      `You have an active project wizard for "${existingState.projectName}".\n\n` +
      `Would you like to continue or start a new project?`,
      { reply_markup: keyboard }
    );
    return;
  }

  // Validate project name if provided
  if (projectName) {
    const validationError = validateProjectName(projectName);
    if (validationError) {
      await ctx.reply(validationError, { parse_mode: 'Markdown' });
      return;
    }
  }

  // Create initial state
  const state = createInitialWizardState(projectName);
  saveWizardState(telegramId, state);

  // Send first step
  await sendCurrentStep(ctx, state);
}

// ============================================================================
// Step Rendering
// ============================================================================

/**
 * Send the current step message with keyboard
 */
async function sendCurrentStep(
  ctx: Context,
  state: ProjectWizardState,
  editMessage = false
): Promise<void> {
  const message = buildStepMessage(state);
  const keyboard = buildStepKeyboard(state);

  // Build options based on whether we have a keyboard
  const editOptions = keyboard
    ? { parse_mode: 'Markdown' as const, reply_markup: keyboard }
    : { parse_mode: 'Markdown' as const };

  const replyOptions = keyboard
    ? { parse_mode: 'Markdown' as const, reply_markup: keyboard }
    : { parse_mode: 'Markdown' as const };

  try {
    if (editMessage && ctx.callbackQuery?.message) {
      await ctx.editMessageText(message, editOptions);
    } else {
      const sent = await ctx.reply(message, replyOptions);

      // Store message ID for later editing
      const telegramId = ctx.from?.id;
      if (telegramId && sent.message_id) {
        state.messageId = sent.message_id;
        saveWizardState(telegramId, state);
      }
    }
  } catch (error) {
    // If edit fails, try sending new message
    if (editMessage) {
      const sent = await ctx.reply(message, replyOptions);

      const telegramId = ctx.from?.id;
      if (telegramId && sent.message_id) {
        state.messageId = sent.message_id;
        saveWizardState(telegramId, state);
      }
    } else {
      console.error('[Wizard] Failed to send step:', error);
    }
  }
}

// ============================================================================
// Callback Handlers
// ============================================================================

/**
 * Handle wizard callback data
 */
export async function handleWizardCallback(
  ctx: Context,
  data: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Answer callback immediately for responsiveness
  await ctx.answerCallbackQuery().catch(() => {});

  // Parse callback data: wizard:category:action:...args
  const parts = data.split(':');
  if (parts[0] !== 'wizard') return;

  const category = parts[1];
  const action = parts[2];
  const args = parts.slice(3);

  if (!category || !action) {
    console.warn('[Wizard] Invalid callback data:', data);
    return;
  }

  // Handle resume callbacks
  if (category === 'resume') {
    await handleResumeCallback(ctx, action);
    return;
  }

  // Get current state
  const state = getWizardState(telegramId);
  if (!state) {
    await ctx.answerCallbackQuery({
      text: 'Session expired. Use /new to start again.',
      show_alert: true,
    });
    return;
  }

  // Handle different callback types
  switch (category) {
    case 'tech':
      await handleTechCallback(ctx, state, action, args);
      break;
    case 'cloud':
      await handleCloudCallback(ctx, state, action, args);
      break;
    case 'nav':
      await handleNavCallback(ctx, state, action);
      break;
    case 'confirm':
      await handleConfirmCallback(ctx, state, action);
      break;
    default:
      console.warn(`[Wizard] Unknown callback category: ${category}`);
  }
}

/**
 * Handle resume/continue callbacks
 */
async function handleResumeCallback(ctx: Context, action: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (action === 'continue') {
    const state = getWizardState(telegramId);
    if (state) {
      await sendCurrentStep(ctx, state, true);
    }
  } else if (action === 'new') {
    clearWizardState(telegramId);
    await ctx.editMessageText(
      'Previous wizard cancelled.\n\n' +
      'Enter the name for your new project:',
      { parse_mode: 'Markdown' }
    );

    // Set state to name input mode
    const state = createInitialWizardState();
    saveWizardState(telegramId, state);
  }
}

/**
 * Handle tech stack toggle callbacks
 */
async function handleTechCallback(
  ctx: Context,
  state: ProjectWizardState,
  action: string,
  args: string[]
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const category = args[0];
  const optionId = args[1];

  if (action === 'toggle' && category && optionId) {
    const techCategory = category as TechCategory;

    // Toggle the selection
    const currentSelections = state.techStack[techCategory];

    // If selecting "none", clear all others
    if (optionId === 'none') {
      state.techStack[techCategory] = ['none'];
    } else {
      // If "none" is currently selected, remove it
      const noneIndex = currentSelections.indexOf('none');
      if (noneIndex !== -1) {
        currentSelections.splice(noneIndex, 1);
      }

      // Toggle the option
      const optionIndex = currentSelections.indexOf(optionId);
      if (optionIndex !== -1) {
        currentSelections.splice(optionIndex, 1);
      } else {
        currentSelections.push(optionId);
      }

      state.techStack[techCategory] = currentSelections;
    }

    saveWizardState(telegramId, state);
    await sendCurrentStep(ctx, state, true);
  }
}

/**
 * Handle cloud services toggle callbacks
 */
async function handleCloudCallback(
  ctx: Context,
  state: ProjectWizardState,
  action: string,
  args: string[]
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const serviceId = args[0];

  if (action === 'toggle' && serviceId) {
    const cloudService = serviceId as CloudServiceId;
    state.cloudServices[cloudService] = !state.cloudServices[cloudService];

    saveWizardState(telegramId, state);
    await sendCurrentStep(ctx, state, true);
  }
}

/**
 * Handle navigation callbacks
 */
async function handleNavCallback(
  ctx: Context,
  state: ProjectWizardState,
  action: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (action === 'next' || action === 'skip') {
    const nextStep = getNextStep(state.step);
    if (nextStep) {
      state.step = nextStep;
      saveWizardState(telegramId, state);
      await sendCurrentStep(ctx, state, true);
    }
  } else if (action === 'back') {
    const prevStep = getPreviousStep(state.step);
    if (prevStep) {
      state.step = prevStep;
      saveWizardState(telegramId, state);
      await sendCurrentStep(ctx, state, true);
    }
  }
}

/**
 * Handle confirmation callbacks
 */
async function handleConfirmCallback(
  ctx: Context,
  state: ProjectWizardState,
  action: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (action === 'create') {
    await createProjectFromWizard(ctx, state);
  } else if (action === 'cancel') {
    clearWizardState(telegramId);
    await ctx.editMessageText(
      '❌ Project creation cancelled.',
      { parse_mode: 'Markdown' }
    );
  }
}

// ============================================================================
// Text Input Handler
// ============================================================================

/**
 * Handle text input for wizard (project name, build goal)
 */
export async function handleWizardTextInput(
  ctx: Context,
  text: string
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const state = getWizardState(telegramId);
  if (!state) return false;

  // Handle based on current step
  if (state.step === 'name') {
    // Validate project name
    const validationError = validateProjectName(text);
    if (validationError) {
      await ctx.reply(validationError, { parse_mode: 'Markdown' });
      return true;
    }

    // Check if project already exists
    const registry = getProjectRegistry();
    const existing = registry.getProject(text);
    if (existing) {
      await ctx.reply(
        `A project named \`${text}\` already exists.\n\nPath: \`${existing.path}\`\n\nPlease choose a different name.`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    // Update state and move to next step
    state.projectName = text;
    state.step = 'tech_frontend';
    saveWizardState(telegramId, state);
    await sendCurrentStep(ctx, state);
    return true;
  }

  if (state.step === 'build_goal') {
    // Save build goal and move to confirmation
    state.buildGoal = text;
    state.step = 'confirm';
    saveWizardState(telegramId, state);
    await sendCurrentStep(ctx, state);
    return true;
  }

  return false;
}

// ============================================================================
// Project Creation
// ============================================================================

/**
 * Create the project from wizard state
 */
async function createProjectFromWizard(
  ctx: Context,
  state: ProjectWizardState
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    // Show creating message
    await ctx.editMessageText(
      `⏳ Creating project "${state.projectName}"...`,
      { parse_mode: 'Markdown' }
    );

    const globalStore = getGlobalStore();
    const basePath = globalStore.getProjectsDirectory();
    const projectPath = path.join(basePath, state.projectName);

    // Create project directory
    if (existsSync(projectPath)) {
      await ctx.editMessageText(
        `❌ Directory already exists: \`${projectPath}\``,
        { parse_mode: 'Markdown' }
      );
      clearWizardState(telegramId);
      return;
    }

    mkdirSync(projectPath, { recursive: true });

    // Initialize git repo
    try {
      await execFileAsync('git', ['init'], { cwd: projectPath });
    } catch (error) {
      console.warn('[Wizard] Failed to init git:', error);
    }

    // Create orchestrator.config.json
    const config = buildProjectConfig(state);
    writeFileSync(
      path.join(projectPath, 'orchestrator.config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create initial CLAUDE.md
    const claudeMd = buildClaudeMd(state);
    writeFileSync(path.join(projectPath, 'CLAUDE.md'), claudeMd);

    // Create .gitignore
    const gitignore = buildGitignore();
    writeFileSync(path.join(projectPath, '.gitignore'), gitignore);

    // Register project in registry
    const registry = getProjectRegistry();
    registry.registerProject({ path: projectPath, name: state.projectName });

    // Create .orchestrator directory for project store
    mkdirSync(path.join(projectPath, '.orchestrator'), { recursive: true });

    // Initialize session in project store
    const projectStore = createStore(projectPath);
    const techStack = buildTechStackFromWizard(state);
    projectStore.createSession({
      projectPath,
      projectName: state.projectName,
      techStack,
    });
    projectStore.close();

    // Clear wizard state
    clearWizardState(telegramId);

    // Show success message
    await ctx.editMessageText(
      `✅ *Project Created!*\n\n` +
      `📁 *${state.projectName}*\n` +
      `📂 \`${projectPath}\`\n\n` +
      `*Next steps:*\n` +
      `• \`/${state.projectName} status\` - Check project status\n` +
      `• \`/${state.projectName} add "requirement"\` - Add requirements\n` +
      `• \`/${state.projectName} plan\` - Generate execution plan`,
      { parse_mode: 'Markdown' }
    );

    // If cloud services were selected, trigger auth flows
    if (state.cloudServices.github || state.cloudServices.supabase || state.cloudServices.vercel) {
      const services: string[] = [];
      if (state.cloudServices.github) services.push('GitHub');
      if (state.cloudServices.supabase) services.push('Supabase');
      if (state.cloudServices.vercel) services.push('Vercel');

      await ctx.reply(
        `🔐 *Cloud Services*\n\n` +
        `You selected: ${services.join(', ')}\n\n` +
        `Use \`/${state.projectName} config\` to set up authentication for these services.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('[Wizard] Failed to create project:', error);
    clearWizardState(telegramId);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await ctx.editMessageText(
      `❌ Failed to create project:\n\n${errorMessage}`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate project name
 */
function validateProjectName(name: string): string | null {
  if (!name || name.trim() === '') {
    return 'Project name cannot be empty.';
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    return (
      'Invalid project name.\n\n' +
      'Project names must:\n' +
      '• Start with a letter\n' +
      '• Contain only letters, numbers, hyphens, and underscores'
    );
  }

  if (name.length > 50) {
    return 'Project name must be 50 characters or less.';
  }

  return null;
}

/**
 * Build project configuration from wizard state
 */
function buildProjectConfig(state: ProjectWizardState): Record<string, unknown> {
  const techStack: Record<string, string[]> = {};

  // Only include non-empty, non-"none" selections
  for (const [category, selections] of Object.entries(state.techStack)) {
    const filtered = selections.filter((s: string) => s !== 'none');
    if (filtered.length > 0) {
      techStack[category] = filtered;
    }
  }

  const cloudServices: string[] = [];
  if (state.cloudServices.github) cloudServices.push('github');
  if (state.cloudServices.supabase) cloudServices.push('supabase');
  if (state.cloudServices.vercel) cloudServices.push('vercel');

  return {
    name: state.projectName,
    version: '1.0.0',
    techStack,
    cloudServices,
    buildGoal: state.buildGoal || undefined,
    createdAt: new Date().toISOString(),
    createdVia: 'telegram-wizard',
  };
}

/**
 * Build initial CLAUDE.md content
 */
function buildClaudeMd(state: ProjectWizardState): string {
  const lines: string[] = [];

  lines.push(`# ${state.projectName}`);
  lines.push('');

  if (state.buildGoal) {
    lines.push('## Goal');
    lines.push('');
    lines.push(state.buildGoal);
    lines.push('');
  }

  lines.push('## Tech Stack');
  lines.push('');

  const hasAnyTech = Object.values(state.techStack).some(
    (selections) => selections.length > 0 && !selections.includes('none')
  );

  if (hasAnyTech) {
    for (const [category, selections] of Object.entries(state.techStack)) {
      const filtered = selections.filter((s: string) => s !== 'none');
      if (filtered.length > 0) {
        const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
        lines.push(`- **${categoryLabel}**: ${filtered.join(', ')}`);
      }
    }
  } else {
    lines.push('*To be determined*');
  }

  lines.push('');
  lines.push('## Development Guidelines');
  lines.push('');
  lines.push('*Add project-specific guidelines here*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Build TechStack from wizard state, mapping wizard selections to expected enum values
 */
function buildTechStackFromWizard(state: ProjectWizardState): TechStack {
  // Map wizard selections to valid TechStack values
  // Use defaults when no selection or incompatible selection
  const frontendMap: Record<string, TechStack['frontend']> = {
    react: 'react',
    vue: 'vue',
    svelte: 'svelte',
    nextjs: 'nextjs',
  };

  const backendMap: Record<string, TechStack['backend']> = {
    node: 'express',
    express: 'express',
    fastify: 'fastify',
    nestjs: 'nestjs',
    hono: 'hono',
  };

  const databaseMap: Record<string, TechStack['database']> = {
    postgres: 'postgresql',
    postgresql: 'postgresql',
    sqlite: 'sqlite',
    mongodb: 'mongodb',
    supabase: 'supabase',
  };

  const stylingMap: Record<string, TechStack['styling']> = {
    tailwind: 'tailwind',
    'css-modules': 'css-modules',
    'styled-components': 'styled-components',
  };

  // Get first selection from each category, fall back to defaults
  const frontend = state.techStack.frontend[0];
  const backend = state.techStack.backend[0];
  const database = state.techStack.database[0];
  const styling = state.techStack.styling[0];

  return {
    frontend: (frontend && frontendMap[frontend]) || DEFAULT_TECH_STACK.frontend,
    backend: (backend && backendMap[backend]) || DEFAULT_TECH_STACK.backend,
    database: (database && databaseMap[database]) || DEFAULT_TECH_STACK.database,
    testing: DEFAULT_TECH_STACK.testing, // Use default for testing
    unitTesting: DEFAULT_TECH_STACK.unitTesting,
    styling: (styling && stylingMap[styling]) || DEFAULT_TECH_STACK.styling,
  };
}

/**
 * Build initial .gitignore content
 */
function buildGitignore(): string {
  return `# Dependencies
node_modules/
vendor/
venv/
__pycache__/

# Build outputs
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Orchestrator
.orchestrator/
`;
}

// ============================================================================
// Exports
// ============================================================================

export { getWizardState, clearWizardState };
