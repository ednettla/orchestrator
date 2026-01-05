/**
 * Action Handler Unit Tests
 *
 * Tests for all action handlers in the unified interaction system.
 * Each handler is tested for success, error, and platform-specific behavior.
 *
 * @module interactions/__tests__/action-handlers.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  executeAction,
  isActionMarker,
  getActionName,
  loadLogsAction,
  followLogsAction,
  stopDaemonAction,
  startDaemonAction,
  runForegroundAction,
  showStatusAction,
  viewLogsAction,
  addRequirementAction,
  listRequirementsAction,
  createPlanAction,
  resumePlanAction,
  approvePlanAction,
  executePlanAction,
  rejectPlanAction,
  initProjectAction,
  projectSettingsAction,
  listMcpAction,
  addMcpAction,
  toggleMcpAction,
  removeMcpAction,
  runSecretsInteractiveAction,
  runProjectsInteractiveAction,
  runTelegramInteractiveAction,
} from '../action-handlers.js';
import { createMockContext, createMockPlan } from './mocks/context.js';
import type { DaemonFlowContext } from '../flows/daemon.js';
import type { RunFlowContext } from '../flows/run.js';
import type { RequirementsFlowContext } from '../flows/requirements.js';
import type { PlanFlowContext } from '../flows/plan.js';
import type { InitFlowContext } from '../flows/init.js';
import type { ConfigFlowContext } from '../flows/config.js';
import type { SecretsFlowContext } from '../flows/secrets.js';
import type { ProjectsFlowContext } from '../flows/projects.js';
import type { TelegramSettingsFlowContext } from '../flows/telegram-settings.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock project-bridge
vi.mock('../../telegram/project-bridge.js', () => ({
  getRecentLogs: vi.fn(),
  addRequirement: vi.fn(),
  startPlanFromApi: vi.fn(),
  approvePlanFromApi: vi.fn(),
  rejectPlanFromApi: vi.fn(),
}));

// Mock daemon
vi.mock('../../cli/daemon.js', () => ({
  tailLogs: vi.fn(),
  stopDaemon: vi.fn(),
  spawnDaemon: vi.fn(),
}));

// Mock CLI commands
vi.mock('../../cli/commands/run.js', () => ({
  runCommand: vi.fn(),
}));

vi.mock('../../cli/commands/status.js', () => ({
  statusCommand: vi.fn(),
}));

vi.mock('../../cli/commands/list.js', () => ({
  listCommand: vi.fn(),
}));

vi.mock('../../cli/commands/plan.js', () => ({
  planCommand: vi.fn(),
}));

vi.mock('../../cli/commands/init.js', () => ({
  initCommand: vi.fn(),
}));

vi.mock('../../cli/commands/config.js', () => ({
  configInteractive: vi.fn(),
}));

vi.mock('../../cli/commands/mcp.js', () => ({
  mcpListCommand: vi.fn(),
}));

vi.mock('../../cli/commands/secrets.js', () => ({
  interactiveCommand: vi.fn(),
}));

vi.mock('../../cli/commands/projects.js', () => ({
  interactiveCommand: vi.fn(),
}));

vi.mock('../../cli/commands/telegram.js', () => ({
  interactiveCommand: vi.fn(),
}));

vi.mock('../../core/mcp-config-manager.js', () => ({
  mcpConfigManager: {
    getMergedConfig: vi.fn(),
    addServer: vi.fn(),
  },
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn().mockResolvedValue(''),
}));

// ============================================================================
// Helper to get mocked modules
// ============================================================================

async function getMocks() {
  const projectBridge = await import('../../telegram/project-bridge.js');
  const daemon = await import('../../cli/daemon.js');
  const runCmd = await import('../../cli/commands/run.js');
  const statusCmd = await import('../../cli/commands/status.js');
  const listCmd = await import('../../cli/commands/list.js');
  const planCmd = await import('../../cli/commands/plan.js');
  const initCmd = await import('../../cli/commands/init.js');
  const configCmd = await import('../../cli/commands/config.js');
  const mcpCmd = await import('../../cli/commands/mcp.js');
  const secretsCmd = await import('../../cli/commands/secrets.js');
  const projectsCmd = await import('../../cli/commands/projects.js');
  const telegramCmd = await import('../../cli/commands/telegram.js');
  const mcpConfig = await import('../../core/mcp-config-manager.js');

  return {
    getRecentLogs: projectBridge.getRecentLogs as Mock,
    addRequirement: projectBridge.addRequirement as Mock,
    startPlanFromApi: projectBridge.startPlanFromApi as Mock,
    approvePlanFromApi: projectBridge.approvePlanFromApi as Mock,
    rejectPlanFromApi: projectBridge.rejectPlanFromApi as Mock,
    tailLogs: daemon.tailLogs as Mock,
    stopDaemon: daemon.stopDaemon as Mock,
    spawnDaemon: daemon.spawnDaemon as Mock,
    runCommand: runCmd.runCommand as Mock,
    statusCommand: statusCmd.statusCommand as Mock,
    listCommand: listCmd.listCommand as Mock,
    planCommand: planCmd.planCommand as Mock,
    initCommand: initCmd.initCommand as Mock,
    configInteractive: configCmd.configInteractive as Mock,
    mcpListCommand: mcpCmd.mcpListCommand as Mock,
    secretsInteractive: secretsCmd.interactiveCommand as Mock,
    projectsInteractive: projectsCmd.interactiveCommand as Mock,
    telegramInteractive: telegramCmd.interactiveCommand as Mock,
    mcpConfigManager: mcpConfig.mcpConfigManager as { getMergedConfig: Mock; addServer: Mock },
  };
}

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('isActionMarker', () => {
  it('returns true for action markers', () => {
    expect(isActionMarker('action:load_logs')).toBe(true);
    expect(isActionMarker('action:stop_daemon')).toBe(true);
  });

  it('returns false for non-action markers', () => {
    expect(isActionMarker('menu')).toBe(false);
    expect(isActionMarker('flow:plan')).toBe(false);
    expect(isActionMarker(null)).toBe(false);
  });
});

describe('getActionName', () => {
  it('extracts action name from marker', () => {
    expect(getActionName('action:load_logs')).toBe('load_logs');
    expect(getActionName('action:stop_daemon')).toBe('stop_daemon');
  });
});

describe('executeAction', () => {
  it('routes to correct handler', async () => {
    const mocks = await getMocks();
    mocks.getRecentLogs.mockResolvedValue(['log1', 'log2']);

    const ctx = createMockContext() as DaemonFlowContext;
    const result = await executeAction('load_logs', ctx, 'cli');

    expect(result.nextStep).toBe('display_logs');
    expect(ctx.logs).toEqual(['log1', 'log2']);
  });

  it('returns error for unknown action', async () => {
    const ctx = createMockContext();
    const result = await executeAction('nonexistent_action', ctx, 'cli');

    expect(result.error).toContain('Unknown action');
  });
});

// ============================================================================
// Daemon Actions
// ============================================================================

describe('Daemon Actions', () => {
  describe('loadLogsAction', () => {
    it('loads logs into context on success', async () => {
      const mocks = await getMocks();
      mocks.getRecentLogs.mockResolvedValue(['log1', 'log2', 'log3']);

      const ctx = createMockContext() as DaemonFlowContext;
      const result = await loadLogsAction(ctx, 'cli');

      expect(mocks.getRecentLogs).toHaveBeenCalledWith('/test/project', 30);
      expect(ctx.logs).toEqual(['log1', 'log2', 'log3']);
      expect(result.nextStep).toBe('display_logs');
    });

    it('returns error when no project path', async () => {
      const ctx = createMockContext({ projectPath: null }) as DaemonFlowContext;
      const result = await loadLogsAction(ctx, 'cli');

      expect(result.nextStep).toBe('error');
      expect(result.error).toBe('No project path');
    });

    it('handles API errors', async () => {
      const mocks = await getMocks();
      mocks.getRecentLogs.mockRejectedValue(new Error('API error'));

      const ctx = createMockContext() as DaemonFlowContext;
      const result = await loadLogsAction(ctx, 'cli');

      expect(ctx.error).toBe('API error');
      expect(result.nextStep).toBe('error');
    });
  });

  describe('followLogsAction', () => {
    it('delegates to loadLogsAction on Telegram', async () => {
      const mocks = await getMocks();
      mocks.getRecentLogs.mockResolvedValue(['log']);

      const ctx = createMockContext() as DaemonFlowContext;
      const result = await followLogsAction(ctx, 'telegram');

      expect(mocks.getRecentLogs).toHaveBeenCalled();
      expect(result.nextStep).toBe('display_logs');
    });

    it('calls tailLogs with follow mode on CLI', async () => {
      const mocks = await getMocks();
      mocks.tailLogs.mockResolvedValue(undefined);

      const ctx = createMockContext() as DaemonFlowContext;
      const result = await followLogsAction(ctx, 'cli');

      expect(mocks.tailLogs).toHaveBeenCalledWith('/test/project', { lines: 30, follow: true });
      expect(result.nextStep).toBe('menu');
    });
  });

  describe('stopDaemonAction', () => {
    it('stops daemon and updates context', async () => {
      const mocks = await getMocks();
      mocks.stopDaemon.mockReturnValue({ success: true });

      const ctx = createMockContext({ daemon: { running: true, pid: 123 } }) as DaemonFlowContext;
      const result = await stopDaemonAction(ctx, 'cli');

      expect(mocks.stopDaemon).toHaveBeenCalledWith('/test/project');
      expect(ctx.daemon.running).toBe(false);
      expect(ctx.stopResult).toEqual({ success: true });
      expect(result.nextStep).toBe('stop_result');
    });

    it('handles stop failure', async () => {
      const mocks = await getMocks();
      mocks.stopDaemon.mockReturnValue({ success: false, error: 'Not running' });

      const ctx = createMockContext() as DaemonFlowContext;
      const result = await stopDaemonAction(ctx, 'cli');

      expect(ctx.stopResult.success).toBe(false);
      expect(result.nextStep).toBe('stop_result');
    });
  });
});

// ============================================================================
// Run Actions
// ============================================================================

describe('Run Actions', () => {
  describe('startDaemonAction', () => {
    it('spawns daemon with concurrency', async () => {
      const mocks = await getMocks();
      mocks.spawnDaemon.mockReturnValue({ success: true, pid: 456 });

      const ctx = createMockContext() as RunFlowContext;
      ctx.concurrency = 5;
      const result = await startDaemonAction(ctx, 'cli');

      expect(mocks.spawnDaemon).toHaveBeenCalledWith('/test/project', 'run', ['-c', '5']);
      expect(ctx.daemon.running).toBe(true);
      expect(ctx.daemon.pid).toBe(456);
      expect(result.nextStep).toBe('run_started');
    });

    it('uses default concurrency of 3', async () => {
      const mocks = await getMocks();
      mocks.spawnDaemon.mockReturnValue({ success: true });

      const ctx = createMockContext() as RunFlowContext;
      await startDaemonAction(ctx, 'cli');

      expect(mocks.spawnDaemon).toHaveBeenCalledWith('/test/project', 'run', ['-c', '3']);
    });

    it('returns error on spawn failure', async () => {
      const mocks = await getMocks();
      mocks.spawnDaemon.mockReturnValue({ success: false, error: 'Port in use' });

      const ctx = createMockContext() as RunFlowContext;
      const result = await startDaemonAction(ctx, 'cli');

      expect(result.error).toBe('Port in use');
      expect(result.nextStep).toBe('menu');
    });
  });

  describe('runForegroundAction', () => {
    it('delegates to startDaemonAction on Telegram', async () => {
      const mocks = await getMocks();
      mocks.spawnDaemon.mockReturnValue({ success: true });

      const ctx = createMockContext() as RunFlowContext;
      const result = await runForegroundAction(ctx, 'telegram');

      expect(mocks.spawnDaemon).toHaveBeenCalled();
      expect(result.nextStep).toBe('run_started');
    });

    it('runs directly on CLI', async () => {
      const mocks = await getMocks();
      mocks.runCommand.mockResolvedValue(undefined);

      const ctx = createMockContext() as RunFlowContext;
      ctx.concurrency = 3;
      const result = await runForegroundAction(ctx, 'cli');

      expect(mocks.runCommand).toHaveBeenCalledWith(undefined, {
        path: '/test/project',
        concurrency: '3',
        background: false,
      });
      expect(result.nextStep).toBe('menu');
    });
  });

  describe('showStatusAction', () => {
    it('returns to menu on Telegram', async () => {
      const ctx = createMockContext() as RunFlowContext;
      const result = await showStatusAction(ctx, 'telegram');

      expect(result.nextStep).toBe('menu');
    });

    it('calls statusCommand on CLI', async () => {
      const mocks = await getMocks();
      mocks.statusCommand.mockResolvedValue(undefined);

      const ctx = createMockContext() as RunFlowContext;
      const result = await showStatusAction(ctx, 'cli');

      expect(mocks.statusCommand).toHaveBeenCalledWith({ path: '/test/project', json: false });
      expect(result.nextStep).toBe('menu');
    });
  });
});

// ============================================================================
// Requirements Actions
// ============================================================================

describe('Requirements Actions', () => {
  describe('addRequirementAction', () => {
    it('adds requirement successfully', async () => {
      const mocks = await getMocks();
      mocks.addRequirement.mockResolvedValue({ success: true });

      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'New Feature';
      ctx.newRequirementDescription = 'Description here';

      const result = await addRequirementAction(ctx, 'cli');

      expect(mocks.addRequirement).toHaveBeenCalledWith('/test/project', 'New Feature\n\nDescription here');
      expect(ctx.requirements.pending).toBe(1);
      expect(result.nextStep).toBe('add_success');
    });

    it('handles add failure', async () => {
      const mocks = await getMocks();
      mocks.addRequirement.mockResolvedValue({ success: false, error: 'Validation failed' });

      const ctx = createMockContext() as RequirementsFlowContext;
      ctx.newRequirementTitle = 'Test';
      const result = await addRequirementAction(ctx, 'cli');

      expect(ctx.error).toBe('Validation failed');
      expect(result.nextStep).toBe('add_error');
    });
  });

  describe('listRequirementsAction', () => {
    it('returns to menu on Telegram', async () => {
      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await listRequirementsAction(ctx, 'telegram');

      expect(result.nextStep).toBe('menu');
    });

    it('calls listCommand on CLI', async () => {
      const mocks = await getMocks();
      mocks.listCommand.mockResolvedValue(undefined);

      const ctx = createMockContext() as RequirementsFlowContext;
      const result = await listRequirementsAction(ctx, 'cli');

      expect(mocks.listCommand).toHaveBeenCalledWith({
        path: '/test/project',
        status: '',
        json: false,
      });
      expect(result.nextStep).toBe('menu');
    });
  });
});

// ============================================================================
// Plan Actions
// ============================================================================

describe('Plan Actions', () => {
  describe('createPlanAction', () => {
    it('creates plan from goal', async () => {
      const mocks = await getMocks();
      mocks.startPlanFromApi.mockResolvedValue({ success: true });

      const ctx = createMockContext() as PlanFlowContext;
      ctx.planGoal = 'Build a todo app';
      const result = await createPlanAction(ctx, 'cli');

      expect(mocks.startPlanFromApi).toHaveBeenCalledWith('/test/project', 'Build a todo app');
      expect(result.nextStep).toBe('menu');
    });

    it('returns error when no goal', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await createPlanAction(ctx, 'cli');

      expect(ctx.error).toBe('No goal provided');
      expect(result.nextStep).toBe('error');
    });

    it('handles API failure', async () => {
      const mocks = await getMocks();
      mocks.startPlanFromApi.mockResolvedValue({ success: false, error: 'Rate limited' });

      const ctx = createMockContext() as PlanFlowContext;
      ctx.planGoal = 'Test';
      const result = await createPlanAction(ctx, 'cli');

      expect(ctx.error).toBe('Rate limited');
      expect(result.nextStep).toBe('error');
    });
  });

  describe('resumePlanAction', () => {
    it('returns to menu on Telegram', async () => {
      const ctx = createMockContext() as PlanFlowContext;
      const result = await resumePlanAction(ctx, 'telegram');

      expect(result.nextStep).toBe('menu');
    });

    it('calls planCommand with resume on CLI', async () => {
      const mocks = await getMocks();
      mocks.planCommand.mockResolvedValue(undefined);

      const ctx = createMockContext() as PlanFlowContext;
      const result = await resumePlanAction(ctx, 'cli');

      expect(mocks.planCommand).toHaveBeenCalledWith(undefined, { path: '/test/project', resume: true });
      expect(result.nextStep).toBe('menu');
    });
  });

  describe('approvePlanAction', () => {
    it('approves plan successfully', async () => {
      const mocks = await getMocks();
      mocks.approvePlanFromApi.mockResolvedValue({ success: true });

      const ctx = createMockContext() as PlanFlowContext;
      const result = await approvePlanAction(ctx, 'cli');

      expect(mocks.approvePlanFromApi).toHaveBeenCalledWith('/test/project');
      expect(result.nextStep).toBe('menu');
    });

    it('handles approval failure', async () => {
      const mocks = await getMocks();
      mocks.approvePlanFromApi.mockResolvedValue({ success: false, error: 'Wrong status' });

      const ctx = createMockContext() as PlanFlowContext;
      const result = await approvePlanAction(ctx, 'cli');

      expect(ctx.error).toBe('Wrong status');
      expect(result.nextStep).toBe('error');
    });
  });

  describe('executePlanAction', () => {
    it('spawns daemon to execute plan', async () => {
      const mocks = await getMocks();
      mocks.spawnDaemon.mockReturnValue({ success: true });

      const ctx = createMockContext() as PlanFlowContext;
      const result = await executePlanAction(ctx, 'cli');

      expect(mocks.spawnDaemon).toHaveBeenCalledWith('/test/project', 'run', ['-c', '3']);
      expect(result.nextStep).toBe('menu');
    });

    it('handles execution failure', async () => {
      const mocks = await getMocks();
      mocks.spawnDaemon.mockReturnValue({ success: false, error: 'Failed' });

      const ctx = createMockContext() as PlanFlowContext;
      const result = await executePlanAction(ctx, 'cli');

      expect(ctx.error).toBe('Failed');
      expect(result.nextStep).toBe('error');
    });
  });

  describe('rejectPlanAction', () => {
    it('rejects plan successfully', async () => {
      const mocks = await getMocks();
      mocks.rejectPlanFromApi.mockResolvedValue({ success: true });

      const ctx = createMockContext() as PlanFlowContext;
      const result = await rejectPlanAction(ctx, 'cli');

      expect(mocks.rejectPlanFromApi).toHaveBeenCalledWith('/test/project', 'Rejected via menu');
      expect(result.nextStep).toBe('menu');
    });
  });
});

// ============================================================================
// Init Actions
// ============================================================================

describe('Init Actions', () => {
  describe('initProjectAction', () => {
    it('returns error on Telegram', async () => {
      const ctx = createMockContext() as InitFlowContext;
      const result = await initProjectAction(ctx, 'telegram');

      expect(result.error).toBe('Use CLI to initialize projects');
      expect(result.nextStep).toBe('error');
    });

    it('runs initCommand on CLI', async () => {
      const mocks = await getMocks();
      mocks.initCommand.mockResolvedValue(undefined);
      mocks.mcpConfigManager.getMergedConfig.mockResolvedValue({
        mcpServers: { server1: { enabled: true }, server2: { enabled: false } },
      });

      const ctx = createMockContext() as InitFlowContext;
      const result = await initProjectAction(ctx, 'cli');

      expect(mocks.initCommand).toHaveBeenCalledWith({
        path: '/test/project',
        interactive: true,
        claudeMd: true,
        cloud: true,
      });
      expect(ctx.initSuccess).toBe(true);
      expect(ctx.mcpServers).toEqual(['server1']);
      expect(result.nextStep).toBe('init_complete');
    });
  });
});

// ============================================================================
// Config Actions
// ============================================================================

describe('Config Actions', () => {
  describe('projectSettingsAction', () => {
    it('returns error on Telegram', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await projectSettingsAction(ctx, 'telegram');

      expect(result.error).toBe('Use CLI for project settings');
      expect(result.nextStep).toBe('menu');
    });

    it('calls configInteractive on CLI', async () => {
      const mocks = await getMocks();
      mocks.configInteractive.mockResolvedValue(undefined);

      const ctx = createMockContext() as ConfigFlowContext;
      const result = await projectSettingsAction(ctx, 'cli');

      expect(mocks.configInteractive).toHaveBeenCalledWith({ path: '/test/project' });
      expect(result.nextStep).toBe('menu');
    });
  });

  describe('listMcpAction', () => {
    it('returns error on Telegram', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await listMcpAction(ctx, 'telegram');

      expect(result.error).toBe('Use CLI for MCP management');
    });

    it('calls mcpListCommand on CLI', async () => {
      const mocks = await getMocks();
      mocks.mcpListCommand.mockResolvedValue(undefined);

      const ctx = createMockContext() as ConfigFlowContext;
      const result = await listMcpAction(ctx, 'cli');

      expect(mocks.mcpListCommand).toHaveBeenCalledWith({ path: '/test/project', global: false });
      expect(result.nextStep).toBe('menu');
    });
  });

  describe('addMcpAction', () => {
    it('adds stdio server', async () => {
      const mocks = await getMocks();
      mocks.mcpConfigManager.addServer.mockResolvedValue(undefined);

      const ctx = createMockContext() as ConfigFlowContext;
      ctx.mcpServerName = 'my-server';
      ctx.mcpTransport = 'stdio';
      ctx.mcpCommand = 'npx';
      ctx.mcpArgs = '-y my-package';

      const result = await addMcpAction(ctx, 'cli');

      expect(mocks.mcpConfigManager.addServer).toHaveBeenCalledWith(
        'my-server',
        { type: 'stdio', enabled: true, command: 'npx', args: ['-y', 'my-package'] },
        expect.any(String)
      );
      expect(ctx.mcpServerName).toBeUndefined();
      expect(result.nextStep).toBe('menu');
    });

    it('adds http server', async () => {
      const mocks = await getMocks();
      mocks.mcpConfigManager.addServer.mockResolvedValue(undefined);

      const ctx = createMockContext() as ConfigFlowContext;
      ctx.mcpServerName = 'api-server';
      ctx.mcpTransport = 'http';
      ctx.mcpUrl = 'http://localhost:3000';

      const result = await addMcpAction(ctx, 'cli');

      expect(mocks.mcpConfigManager.addServer).toHaveBeenCalledWith(
        'api-server',
        { type: 'http', enabled: true, url: 'http://localhost:3000' },
        expect.any(String)
      );
      expect(result.nextStep).toBe('menu');
    });

    it('returns error when missing config', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await addMcpAction(ctx, 'cli');

      expect(result.error).toBe('Missing server configuration');
    });
  });

  describe('toggleMcpAction', () => {
    it('returns error message on CLI', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await toggleMcpAction(ctx, 'cli');

      expect(result.error).toContain('Use "orchestrate mcp enable/disable');
    });

    it('returns error on Telegram', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await toggleMcpAction(ctx, 'telegram');

      expect(result.error).toBe('Use CLI for MCP management');
    });
  });

  describe('removeMcpAction', () => {
    it('returns error message on CLI', async () => {
      const ctx = createMockContext() as ConfigFlowContext;
      const result = await removeMcpAction(ctx, 'cli');

      expect(result.error).toContain('Use "orchestrate mcp remove');
    });
  });
});

// ============================================================================
// CLI-Only Actions (Secrets, Projects, Telegram Settings)
// ============================================================================

describe('CLI-Only Actions', () => {
  describe('runSecretsInteractiveAction', () => {
    it('returns cli_only on Telegram', async () => {
      const ctx = createMockContext() as SecretsFlowContext;
      const result = await runSecretsInteractiveAction(ctx, 'telegram');

      expect(result.nextStep).toBe('cli_only');
    });

    it('runs interactive command on CLI', async () => {
      const mocks = await getMocks();
      mocks.secretsInteractive.mockResolvedValue(undefined);

      const ctx = createMockContext() as SecretsFlowContext;
      const result = await runSecretsInteractiveAction(ctx, 'cli');

      expect(mocks.secretsInteractive).toHaveBeenCalledWith({ path: '/test/project' });
      expect(result.nextStep).toBeNull();
    });
  });

  describe('runProjectsInteractiveAction', () => {
    it('returns cli_only on Telegram', async () => {
      const ctx = createMockContext() as ProjectsFlowContext;
      const result = await runProjectsInteractiveAction(ctx, 'telegram');

      expect(result.nextStep).toBe('cli_only');
    });

    it('runs interactive command on CLI', async () => {
      const mocks = await getMocks();
      mocks.projectsInteractive.mockResolvedValue(undefined);

      const ctx = createMockContext() as ProjectsFlowContext;
      const result = await runProjectsInteractiveAction(ctx, 'cli');

      expect(mocks.projectsInteractive).toHaveBeenCalled();
      expect(result.nextStep).toBeNull();
    });
  });

  describe('runTelegramInteractiveAction', () => {
    it('returns cli_only on Telegram', async () => {
      const ctx = createMockContext() as TelegramSettingsFlowContext;
      const result = await runTelegramInteractiveAction(ctx, 'telegram');

      expect(result.nextStep).toBe('cli_only');
    });

    it('runs interactive command on CLI', async () => {
      const mocks = await getMocks();
      mocks.telegramInteractive.mockResolvedValue(undefined);

      const ctx = createMockContext() as TelegramSettingsFlowContext;
      const result = await runTelegramInteractiveAction(ctx, 'cli');

      expect(mocks.telegramInteractive).toHaveBeenCalled();
      expect(result.nextStep).toBeNull();
    });
  });
});

// ============================================================================
// Error Handling Patterns
// ============================================================================

describe('Error Handling Patterns', () => {
  it('all handlers catch and report errors', async () => {
    const mocks = await getMocks();
    mocks.getRecentLogs.mockRejectedValue(new Error('Network error'));

    const ctx = createMockContext() as DaemonFlowContext;
    const result = await loadLogsAction(ctx, 'cli');

    expect(ctx.error).toBe('Network error');
    expect(result.nextStep).toBe('error');
  });

  it('handlers return appropriate error step', async () => {
    const ctx = createMockContext({ projectPath: null }) as DaemonFlowContext;
    const result = await loadLogsAction(ctx, 'cli');

    expect(result.nextStep).toBe('error');
    expect(result.error).toBe('No project path');
  });

  it('handlers handle non-Error exceptions', async () => {
    const mocks = await getMocks();
    mocks.getRecentLogs.mockRejectedValue('String error');

    const ctx = createMockContext() as DaemonFlowContext;
    const result = await loadLogsAction(ctx, 'cli');

    expect(ctx.error).toBe('Failed to load logs');
  });
});

// ============================================================================
// Platform Behavior Tests
// ============================================================================

describe('Platform Behavior', () => {
  it('Telegram-incompatible actions return appropriate response', async () => {
    const handlers: Array<{
      action: (ctx: any, platform: 'cli' | 'telegram') => Promise<{ nextStep: string | null; error?: string }>;
      ctx: any;
    }> = [
      { action: initProjectAction, ctx: createMockContext() as InitFlowContext },
      { action: projectSettingsAction, ctx: createMockContext() as ConfigFlowContext },
      { action: listMcpAction, ctx: createMockContext() as ConfigFlowContext },
      { action: toggleMcpAction, ctx: createMockContext() as ConfigFlowContext },
      { action: removeMcpAction, ctx: createMockContext() as ConfigFlowContext },
    ];

    for (const { action, ctx } of handlers) {
      const result = await action(ctx, 'telegram');
      expect(result.error || result.nextStep).toBeDefined();
    }
  });

  it('CLI-only flows return cli_only on Telegram', async () => {
    const handlers = [
      { action: runSecretsInteractiveAction, ctx: createMockContext() as SecretsFlowContext },
      { action: runProjectsInteractiveAction, ctx: createMockContext() as ProjectsFlowContext },
      { action: runTelegramInteractiveAction, ctx: createMockContext() as TelegramSettingsFlowContext },
    ];

    for (const { action, ctx } of handlers) {
      const result = await action(ctx, 'telegram');
      expect(result.nextStep).toBe('cli_only');
    }
  });
});
