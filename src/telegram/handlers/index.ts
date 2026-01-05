/**
 * Telegram Command Handlers Index
 *
 * Registry of all command handlers.
 *
 * @module telegram/handlers
 */

import { registerCommand } from '../router.js';
import type { CommandDefinition } from '../types.js';

// Import individual handlers
import { startHandler, helpHandler, webappHandler } from './start.js';
import { projectsHandler, switchHandler, newProjectHandler } from './project.js';
import { planHandler, approveHandler, rejectHandler, answerHandler, questionsHandler } from './plan.js';
import { runHandler, stopHandler, resumeHandler, refreshHandler } from './run.js';
import { addHandler, editHandler, priorityHandler, deleteHandler, reqsHandler } from './requirements.js';
import { configHandler, mcpHandler, secretsHandler } from './config.js';
import { logsHandler } from './logs.js';
import { statusHandler } from './status.js';
import { designHandler } from './design.js';

// Unified flow menu handler
import { menuHandler } from './menu.js';

// Export callback-based handler registration functions
export { registerInitHandlers } from './init.js';
export { registerPathsHandlers } from './paths.js';
export { registerCallbackHandlers } from './callbacks.js';

// ============================================================================
// Command Definitions
// ============================================================================

const commandDefinitions: CommandDefinition[] = [
  // Global commands
  {
    name: 'start',
    description: 'Welcome and authentication',
    usage: '/start',
    handler: startHandler,
    requiredRole: 'viewer',
    projectScoped: false,
  },
  {
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: helpHandler,
    requiredRole: 'viewer',
    projectScoped: false,
  },
  {
    name: 'menu',
    description: 'Open interactive menu',
    usage: '/menu',
    handler: menuHandler,
    requiredRole: 'viewer',
    projectScoped: false,
  },
  {
    name: 'webapp',
    description: 'Open the Mini App',
    usage: '/webapp',
    handler: webappHandler,
    requiredRole: 'viewer',
    projectScoped: false,
  },
  {
    name: 'projects',
    description: 'List all projects',
    usage: '/projects',
    handler: projectsHandler,
    requiredRole: 'viewer',
    projectScoped: false,
  },
  {
    name: 'switch',
    description: 'Set active project for session',
    usage: '/switch <project>',
    handler: switchHandler,
    requiredRole: 'viewer',
    projectScoped: false,
  },
  {
    name: 'new',
    description: 'Create a new project',
    usage: '/new <name>',
    handler: newProjectHandler,
    requiredRole: 'operator',
    projectScoped: false,
  },

  // Project-scoped commands
  {
    name: 'status',
    description: 'Show project status',
    usage: '/<project> status',
    handler: statusHandler,
    requiredRole: 'viewer',
    projectScoped: true,
  },
  {
    name: 'plan',
    description: 'Start autonomous planning',
    usage: '/<project> plan "goal"',
    handler: planHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'approve',
    description: 'Approve pending plan',
    usage: '/<project> approve',
    handler: approveHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'reject',
    description: 'Reject pending plan',
    usage: '/<project> reject',
    handler: rejectHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'answer',
    description: 'Answer a plan question',
    usage: '/<project> answer <id> "answer"',
    handler: answerHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'questions',
    description: 'Show pending plan questions',
    usage: '/<project> questions',
    handler: questionsHandler,
    requiredRole: 'viewer',
    projectScoped: true,
  },
  {
    name: 'run',
    description: 'Run pending requirements',
    usage: '/<project> run',
    handler: runHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'stop',
    description: 'Stop running daemon',
    usage: '/<project> stop',
    handler: stopHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'resume',
    description: 'Resume interrupted session',
    usage: '/<project> resume',
    handler: resumeHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'refresh',
    description: 'Regenerate CLAUDE.md',
    usage: '/<project> refresh [--secrets]',
    handler: refreshHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'add',
    description: 'Add a new requirement',
    usage: '/<project> add "requirement"',
    handler: addHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'edit',
    description: 'Edit requirement text',
    usage: '/<project> edit <id> "new text"',
    handler: editHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'priority',
    description: 'Set requirement priority',
    usage: '/<project> priority <id> <0-10>',
    handler: priorityHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'delete',
    description: 'Delete a requirement',
    usage: '/<project> delete <id>',
    handler: deleteHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'reqs',
    description: 'List requirements',
    usage: '/<project> reqs',
    handler: reqsHandler,
    requiredRole: 'viewer',
    projectScoped: true,
  },
  {
    name: 'logs',
    description: 'Show recent logs',
    usage: '/<project> logs [n]',
    handler: logsHandler,
    requiredRole: 'viewer',
    projectScoped: true,
  },
  {
    name: 'config',
    description: 'Show project configuration',
    usage: '/<project> config',
    handler: configHandler,
    requiredRole: 'viewer',
    projectScoped: true,
  },
  {
    name: 'mcp',
    description: 'List MCP servers',
    usage: '/<project> mcp',
    handler: mcpHandler,
    requiredRole: 'viewer',
    projectScoped: true,
  },
  {
    name: 'secrets',
    description: 'List secrets (no values)',
    usage: '/<project> secrets [env]',
    handler: secretsHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
  {
    name: 'design',
    description: 'Manage design system',
    usage: '/<project> design [audit|generate]',
    handler: designHandler,
    requiredRole: 'operator',
    projectScoped: true,
  },
];

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all command handlers
 */
export function registerAllHandlers(): void {
  for (const definition of commandDefinitions) {
    registerCommand(definition);
  }
}

/**
 * Get command help text
 */
export function getHelpText(): string {
  const lines = [
    '*Orchestrator Bot*',
    '',
    '*Recommended:* Use `/menu` for an interactive experience!',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '*Quick Commands*',
    '`/menu` - Interactive menu (best experience)',
    '`/projects` - List your projects',
    '`/switch <name>` - Set active project',
    '',
    '*Planning & Execution*',
    '`/plan` - Create autonomous project plan',
    '`/run` - Execute pending requirements',
    '`/status` - Check project status',
    '',
    '*Requirements*',
    '`/add "text"` - Add a requirement',
    '`/reqs` - List all requirements',
    '',
    '*Monitoring*',
    '`/logs` - View recent logs',
    '`/stop` - Stop running daemon',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '_These commands use your active project._',
    '_Set one with /switch or /projects first._',
  ];

  return lines.join('\n');
}

export { commandDefinitions };
