/**
 * Callback Query Handlers
 *
 * Unified handler for all inline keyboard button presses.
 *
 * @module telegram/handlers/callbacks
 */

import type { Bot, Context } from 'grammy';
import { parseCallbackData, type CallbackData } from '../types.js';
import { getProjectRegistry } from '../../core/project-registry.js';
import { getGlobalStore } from '../../core/global-store.js';
import { handleWizardCallback } from '../flows/project-wizard.js';
import { handlePlanWizardCallback } from '../flows/plan-wizard.js';
import { safeEditMessage } from '../utils/safe-edit.js';
import {
  getProjectStatus,
  getDaemonStatus,
  startRun,
  stopDaemon,
  startPlan,
  getRequirements,
  getRequirement,
  getRecentLogs,
  approvePlanFromApi,
  rejectPlanFromApi,
  runRequirementFromApi,
} from '../project-bridge.js';
import {
  projectActionsKeyboard,
  planApprovalKeyboard,
  requirementsListKeyboard,
  requirementActionsKeyboard,
  logsNavigationKeyboard,
  configMenuKeyboard,
} from '../keyboards.js';

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all callback query handlers
 */
export function registerCallbackHandlers(bot: Bot): void {
  // Handle all callback queries with colon-separated data
  bot.on('callback_query:data', handleCallback);
}

/**
 * Main callback router
 */
async function handleCallback(ctx: Context): Promise<void> {
  const rawData = ctx.callbackQuery?.data ?? '';

  // Handle wizard callbacks first (wizard:category:action:...)
  if (rawData.startsWith('wizard:')) {
    await handleWizardCallback(ctx, rawData);
    return;
  }

  // Handle plan wizard callbacks (planwiz:action:projectName:...)
  if (rawData.startsWith('planwiz:')) {
    await handlePlanWizardCallback(ctx, rawData);
    return;
  }

  const data = parseCallbackData(rawData);
  const store = getGlobalStore();
  const user = store.getUser(ctx.from?.id ?? 0);

  if (!user) {
    await ctx.answerCallbackQuery({ text: 'Unauthorized' });
    return;
  }

  try {
    switch (data.action) {
      // Project Actions
      case 'status':
        await handleStatus(ctx, data);
        break;
      case 'plan':
        await handlePlanView(ctx, data);
        break;
      case 'run':
        await handleRunConfirm(ctx, data);
        break;
      case 'stop':
        await handleStopConfirm(ctx, data);
        break;
      case 'logs':
        await handleLogs(ctx, data);
        break;
      case 'config':
        await handleConfig(ctx, data);
        break;

      // Project Selection
      case 'select':
        await handleSelect(ctx, data, user.telegramId);
        break;

      // Plan Actions
      case 'approve':
        await handleApprove(ctx, data);
        break;
      case 'reject':
        await handleReject(ctx, data);
        break;
      case 'plan_details':
        await handlePlanDetails(ctx, data);
        break;
      case 'start_plan':
        await handleStartPlan(ctx, data);
        break;

      // Run Actions
      case 'start_run':
        await handleStartRun(ctx, data);
        break;
      case 'confirm_stop':
        await handleConfirmStop(ctx, data);
        break;

      // Logs Actions
      case 'logs_more':
        await handleLogsMore(ctx, data);
        break;
      case 'logs_refresh':
        await handleLogsRefresh(ctx, data);
        break;

      // Requirement Actions
      case 'req_details':
        await handleReqDetails(ctx, data);
        break;
      case 'req_all':
        await handleReqAll(ctx, data);
        break;
      case 'run_req':
        await handleRunReq(ctx, data);
        break;
      case 'edit_req':
        await handleEditReq(ctx, data);
        break;
      case 'retry_req':
        await handleRetryReq(ctx, data);
        break;
      case 'reqs':
        await handleReqs(ctx, data);
        break;

      // Config Actions
      case 'config_settings':
        await handleConfigSettings(ctx, data);
        break;
      case 'config_mcp':
        await handleConfigMcp(ctx, data);
        break;
      case 'config_secrets':
        await handleConfigSecrets(ctx, data);
        break;
      case 'config_cloud':
        await handleConfigCloud(ctx, data);
        break;

      // General
      case 'cancel':
        await handleCancel(ctx);
        break;

      default:
        await ctx.answerCallbackQuery({ text: `Unknown action: ${data.action}` });
    }
  } catch (error) {
    console.error('[Callback] Error:', error);
    await ctx.answerCallbackQuery({
      text: 'An error occurred',
      show_alert: true,
    });
  }
}

// ============================================================================
// Project Actions
// ============================================================================

async function handleStatus(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const status = await getProjectStatus(project.path);
  const daemonStatus = await getDaemonStatus(project.path);

  const phaseEmoji = getPhaseEmoji(status.phase);
  const daemonIcon = daemonStatus.running ? '🟢' : '⚪';

  const lines = [
    `📊 *${project.name} Status*`,
    '',
    `${phaseEmoji} Phase: ${status.phase}`,
    `${daemonIcon} Daemon: ${daemonStatus.running ? `Running (PID ${daemonStatus.pid})` : 'Stopped'}`,
    '',
    '*Requirements:*',
    `⏳ Pending: ${status.requirements.pending}`,
    `🔄 In Progress: ${status.requirements.inProgress}`,
    `✅ Completed: ${status.requirements.completed}`,
    `❌ Failed: ${status.requirements.failed}`,
  ];

  if (status.lastActivity) {
    lines.push('', `_Last activity: ${status.lastActivity}_`);
  }

  await safeEditMessage(ctx,lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: projectActionsKeyboard(project.name),
  });
  await ctx.answerCallbackQuery();
}

async function handlePlanView(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  await safeEditMessage(ctx,
    `📋 *Plan for ${project.name}*\n\n` +
      `To create a new plan, use:\n` +
      `\`/${project.name} plan "your goal"\`\n\n` +
      `Or check existing plans in the Mini App.`,
    {
      parse_mode: 'Markdown',
      reply_markup: projectActionsKeyboard(project.name),
    }
  );
  await ctx.answerCallbackQuery();
}

async function handleRunConfirm(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const status = await getProjectStatus(project.path);
  const daemonStatus = await getDaemonStatus(project.path);

  if (daemonStatus.running) {
    await ctx.answerCallbackQuery({ text: 'Daemon already running!' });
    return;
  }

  if (status.requirements.pending === 0 && status.requirements.inProgress === 0) {
    await ctx.answerCallbackQuery({ text: 'No pending requirements' });
    return;
  }

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .text('▶️ Start Execution', `start_run:${project.name}`)
    .text('❌ Cancel', `cancel:${project.name}`);

  await safeEditMessage(ctx,
    `▶️ *Start Execution?*\n\n` +
      `Project: ${project.name}\n` +
      `Pending: ${status.requirements.pending} requirements\n\n` +
      `This will start the daemon in the background.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
  await ctx.answerCallbackQuery();
}

async function handleStopConfirm(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const daemonStatus = await getDaemonStatus(project.path);

  if (!daemonStatus.running) {
    await ctx.answerCallbackQuery({ text: 'No daemon running' });
    return;
  }

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .text('⏹ Confirm Stop', `confirm_stop:${project.name}`)
    .text('❌ Cancel', `cancel:${project.name}`);

  await safeEditMessage(ctx,
    `⏹ *Stop Daemon?*\n\n` +
      `Project: ${project.name}\n` +
      `PID: ${daemonStatus.pid}\n\n` +
      `This will interrupt any running tasks.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
  await ctx.answerCallbackQuery();
}

async function handleLogs(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const logs = await getRecentLogs(project.path, 15);

  if (logs.length === 0) {
    await safeEditMessage(ctx,`📝 *Logs for ${project.name}*\n\n_No logs yet._`, {
      parse_mode: 'Markdown',
      reply_markup: projectActionsKeyboard(project.name),
    });
    await ctx.answerCallbackQuery();
    return;
  }

  const formattedLogs = logs.slice(-10).map((line) => `\`${truncate(line, 60)}\``).join('\n');

  await safeEditMessage(ctx,`📝 *Recent Logs*\n\n${formattedLogs}`, {
    parse_mode: 'Markdown',
    reply_markup: logsNavigationKeyboard(project.name, { hasMore: logs.length >= 15 }),
  });
  await ctx.answerCallbackQuery();
}

async function handleConfig(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  await safeEditMessage(ctx,
    `⚙️ *Configuration: ${project.name}*\n\n` +
      `Path: \`${project.path}\`\n` +
      `Alias: ${project.alias ?? '_none_'}\n\n` +
      `Select a category:`,
    {
      parse_mode: 'Markdown',
      reply_markup: configMenuKeyboard(project.name),
    }
  );
  await ctx.answerCallbackQuery();
}

// ============================================================================
// Project Selection
// ============================================================================

async function handleSelect(ctx: Context, data: CallbackData, telegramId: number): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  // Set as active project
  const store = getGlobalStore();
  store.setConversationState(telegramId, { activeProject: project.name });

  // Show project with action buttons
  const status = await getProjectStatus(project.path);
  const phaseEmoji = getPhaseEmoji(status.phase);

  await safeEditMessage(ctx,
    `✅ *Active: ${project.name}*\n\n` +
      `${phaseEmoji} Phase: ${status.phase}\n` +
      `📊 Requirements: ${status.requirements.pending} pending, ${status.requirements.completed} done\n\n` +
      `Select an action:`,
    {
      parse_mode: 'Markdown',
      reply_markup: projectActionsKeyboard(project.name),
    }
  );
  await ctx.answerCallbackQuery({ text: `Switched to ${project.name}` });
}

// ============================================================================
// Plan Actions
// ============================================================================

async function handleApprove(ctx: Context, data: CallbackData): Promise<void> {
  // Answer immediately to prevent double-click issues
  await ctx.answerCallbackQuery({ text: 'Approving...' });

  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await safeEditMessage(ctx, '❌ Project not found', { parse_mode: 'Markdown' });
    return;
  }

  const result = await approvePlanFromApi(project.path);

  if (!result.success) {
    await safeEditMessage(ctx,
      `❌ *Approval Failed*\n\n${result.error ?? 'Unknown error'}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeEditMessage(ctx,
    `✅ *Plan Approved!*\n\n` +
      `Project: ${project.name}\n\n` +
      `Use the ▶️ Run button to start execution.`,
    {
      parse_mode: 'Markdown',
      reply_markup: projectActionsKeyboard(project.name),
    }
  );
}

async function handleReject(ctx: Context, data: CallbackData): Promise<void> {
  // Answer immediately to prevent double-click issues
  await ctx.answerCallbackQuery({ text: 'Rejecting...' });

  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await safeEditMessage(ctx, '❌ Project not found', { parse_mode: 'Markdown' });
    return;
  }

  const result = await rejectPlanFromApi(project.path);

  if (!result.success) {
    await safeEditMessage(ctx,
      `❌ *Rejection Failed*\n\n${result.error ?? 'Unknown error'}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeEditMessage(ctx,
    `❌ *Plan Rejected*\n\n` +
      `Project: ${project.name}\n\n` +
      `Create a new plan with:\n` +
      `\`/${project.name} plan "new goal"\``,
    { parse_mode: 'Markdown' }
  );
}

async function handlePlanDetails(ctx: Context, data: CallbackData): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'View full plan in Mini App' });
}

async function handleStartPlan(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  await safeEditMessage(ctx,
    `🚀 *Starting Planning*\n\n` +
      `Project: ${project.name}\n\n` +
      `_Analyzing requirements..._`,
    { parse_mode: 'Markdown' }
  );

  const result = await startPlan(project.path, '');

  if (!result.success) {
    await safeEditMessage(ctx,
      `❌ *Planning Failed*\n\n` + `Error: ${result.error ?? result.output}`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCallbackQuery({ text: 'Failed to start planning' });
    return;
  }

  await safeEditMessage(ctx,
    `🚀 *Planning Started*\n\n` +
      `Project: ${project.name}\n\n` +
      `The planner is running in the background.\n` +
      `You'll be notified when a plan is ready for review.`,
    {
      parse_mode: 'Markdown',
      reply_markup: projectActionsKeyboard(project.name),
    }
  );
  await ctx.answerCallbackQuery({ text: 'Planning started!' });
}

// ============================================================================
// Run Actions
// ============================================================================

async function handleStartRun(ctx: Context, data: CallbackData): Promise<void> {
  // Answer immediately to prevent double-click issues
  await ctx.answerCallbackQuery({ text: 'Starting...' });

  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await safeEditMessage(ctx, '❌ Project not found', { parse_mode: 'Markdown' });
    return;
  }

  // Check if already running (idempotency)
  const daemonStatus = await getDaemonStatus(project.path);
  if (daemonStatus.running) {
    await safeEditMessage(ctx,
      `✅ *Already Running*\n\nProject: ${project.name}\nPID: ${daemonStatus.pid}`,
      { parse_mode: 'Markdown', reply_markup: projectActionsKeyboard(project.name) }
    );
    return;
  }

  await safeEditMessage(ctx,`▶️ *Starting Execution*\n\n_Please wait..._`, {
    parse_mode: 'Markdown',
  });

  const result = await startRun(project.path);

  if (!result.success) {
    await safeEditMessage(ctx,
      `❌ *Failed to Start*\n\n` + `Error: ${result.error ?? result.output}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeEditMessage(ctx,
    `▶️ *Execution Started*\n\n` +
      `Project: ${project.name}\n\n` +
      `The daemon is now running in the background.\n` +
      `Use 📊 Status to check progress.`,
    {
      parse_mode: 'Markdown',
      reply_markup: projectActionsKeyboard(project.name),
    }
  );
}

async function handleConfirmStop(ctx: Context, data: CallbackData): Promise<void> {
  // Answer immediately to prevent double-click issues
  await ctx.answerCallbackQuery({ text: 'Stopping...' });

  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await safeEditMessage(ctx, '❌ Project not found', { parse_mode: 'Markdown' });
    return;
  }

  // Check if already stopped (idempotency)
  const daemonStatus = await getDaemonStatus(project.path);
  if (!daemonStatus.running) {
    await safeEditMessage(ctx,
      `⏹ *Already Stopped*\n\nProject: ${project.name}`,
      { parse_mode: 'Markdown', reply_markup: projectActionsKeyboard(project.name) }
    );
    return;
  }

  const result = await stopDaemon(project.path);

  if (!result.success) {
    await safeEditMessage(ctx,
      `❌ *Failed to Stop*\n\n${result.error ?? 'Unknown error'}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeEditMessage(ctx,`⏹ *Daemon Stopped*\n\nProject: ${project.name}`, {
    parse_mode: 'Markdown',
    reply_markup: projectActionsKeyboard(project.name),
  });
}

// ============================================================================
// Logs Actions
// ============================================================================

async function handleLogsMore(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const offset = parseInt(data.extra ?? '0', 10);
  const logs = await getRecentLogs(project.path, offset + 20);

  const displayLogs = logs.slice(Math.max(0, logs.length - 20));
  const formattedLogs = displayLogs.map((line) => `\`${truncate(line, 60)}\``).join('\n');

  await safeEditMessage(ctx,`📝 *Logs (${displayLogs.length} lines)*\n\n${formattedLogs}`, {
    parse_mode: 'Markdown',
    reply_markup: logsNavigationKeyboard(project.name, {
      hasMore: logs.length >= offset + 20,
      currentOffset: offset,
    }),
  });
  await ctx.answerCallbackQuery();
}

async function handleLogsRefresh(ctx: Context, data: CallbackData): Promise<void> {
  await handleLogs(ctx, data);
}

// ============================================================================
// Requirement Actions
// ============================================================================

async function handleReqDetails(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const req = await getRequirement(project.path, data.requirementId ?? '');

  if (!req) {
    await ctx.answerCallbackQuery({ text: 'Requirement not found' });
    return;
  }

  const statusEmoji = getStatusEmoji(req.status);

  await safeEditMessage(ctx,
    `${statusEmoji} *Requirement*\n\n` +
      `${req.title}\n\n` +
      `Status: ${req.status}\n` +
      `Priority: ${req.priority}/10\n` +
      `Created: ${req.createdAt}`,
    {
      parse_mode: 'Markdown',
      reply_markup: requirementActionsKeyboard(project.name, req.id, req.status),
    }
  );
  await ctx.answerCallbackQuery();
}

async function handleReqAll(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const reqs = await getRequirements(project.path);

  if (reqs.length === 0) {
    await safeEditMessage(ctx,
      `📋 *Requirements: ${project.name}*\n\n` +
        `_No requirements yet._\n\n` +
        `Add one with:\n` +
        `\`/${project.name} add "your requirement"\``,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  const lines = [`📋 *All Requirements (${reqs.length})*\n`];
  for (const req of reqs) {
    const emoji = getStatusEmoji(req.status);
    lines.push(`${emoji} ${truncate(req.title, 40)}`);
  }

  await safeEditMessage(ctx,lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: requirementsListKeyboard(project.name, reqs),
  });
  await ctx.answerCallbackQuery();
}

async function handleRunReq(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const result = await runRequirementFromApi(project.path, data.requirementId ?? '');

  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error ?? 'Failed to run', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Requirement started!' });

  // Refresh details
  await handleReqDetails(ctx, data);
}

async function handleEditReq(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  await safeEditMessage(ctx,
    `✏️ *Edit Requirement*\n\n` +
      `To edit this requirement, use:\n` +
      `\`/${project.name} edit ${data.requirementId} "new text"\`\n\n` +
      `Or edit in the Mini App for a better experience.`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCallbackQuery();
}

async function handleRetryReq(ctx: Context, data: CallbackData): Promise<void> {
  await handleRunReq(ctx, data);
}

async function handleReqs(ctx: Context, data: CallbackData): Promise<void> {
  await handleReqAll(ctx, data);
}

// ============================================================================
// Config Actions
// ============================================================================

async function handleConfigSettings(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const techStack = [
    project.techStack?.frontend,
    project.techStack?.backend,
    project.techStack?.database,
  ]
    .filter(Boolean)
    .join(' + ');

  await safeEditMessage(ctx,
    `🔧 *Project Settings*\n\n` +
      `Name: ${project.name}\n` +
      `Alias: ${project.alias ?? '_none_'}\n` +
      `Path: \`${project.path}\`\n` +
      `Tech: ${techStack || '_not detected_'}\n` +
      `Status: ${project.status}`,
    {
      parse_mode: 'Markdown',
      reply_markup: configMenuKeyboard(project.name),
    }
  );
  await ctx.answerCallbackQuery();
}

async function handleConfigMcp(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  // Read actual MCP config
  const { existsSync, readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const configPath = path.join(project.path, '.orchestrator', 'config.json');

  let mcpServers: Record<string, { enabled: boolean }> = {};

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      mcpServers = config.mcpServers ?? {};
    } catch {
      // Ignore parse errors
    }
  }

  const serverNames = Object.keys(mcpServers);

  if (serverNames.length === 0) {
    await safeEditMessage(ctx,
      `🔌 *MCP Servers*\n\n` +
        `_No MCP servers configured._\n\n` +
        `Configure in \`.orchestrator/config.json\``,
      {
        parse_mode: 'Markdown',
        reply_markup: configMenuKeyboard(project.name),
      }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  const lines = [`🔌 *MCP Servers*\n`];
  for (const name of serverNames) {
    const server = mcpServers[name];
    const status = server?.enabled ? '🟢' : '⚪';
    lines.push(`${status} ${name}`);
  }

  await safeEditMessage(ctx,lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: configMenuKeyboard(project.name),
  });
  await ctx.answerCallbackQuery();
}

async function handleConfigSecrets(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  await safeEditMessage(ctx,
    `🔐 *Secrets*\n\n` +
      `_Secret values are hidden for security._\n\n` +
      `Manage secrets with:\n` +
      `\`/${project.name} secrets\``,
    {
      parse_mode: 'Markdown',
      reply_markup: configMenuKeyboard(project.name),
    }
  );
  await ctx.answerCallbackQuery();
}

async function handleConfigCloud(ctx: Context, data: CallbackData): Promise<void> {
  const registry = getProjectRegistry();
  const project = registry.getProject(data.projectName ?? '');

  if (!project) {
    await ctx.answerCallbackQuery({ text: 'Project not found' });
    return;
  }

  const cloud = project.cloudServices ?? {};
  const lines = [`☁️ *Cloud Services*\n`];

  if (cloud.github) {
    lines.push(`🐙 GitHub: ${cloud.github}`);
  }
  if (cloud.supabase) {
    lines.push(`⚡ Supabase: ${cloud.supabase}`);
  }
  if (cloud.vercel) {
    lines.push(`▲ Vercel: ${cloud.vercel}`);
  }

  if (lines.length === 1) {
    lines.push('_No cloud services configured._');
  }

  await safeEditMessage(ctx,lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: configMenuKeyboard(project.name),
  });
  await ctx.answerCallbackQuery();
}

// ============================================================================
// General Actions
// ============================================================================

async function handleCancel(ctx: Context): Promise<void> {
  await safeEditMessage(ctx,'_Cancelled._', { parse_mode: 'Markdown' });
  await ctx.answerCallbackQuery();
}

// ============================================================================
// Helpers
// ============================================================================

function getPhaseEmoji(phase: string): string {
  switch (phase) {
    case 'idle':
      return '💤';
    case 'planning':
      return '🧠';
    case 'architecting':
      return '📐';
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
