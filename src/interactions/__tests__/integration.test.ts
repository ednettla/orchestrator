/**
 * Integration Tests
 *
 * Tests for full flow execution with FlowRunner and action handler integration.
 *
 * @module interactions/__tests__/integration.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowRunner, runFlowCli } from '../runner.js';
import { createMockRenderer, type MockRenderer } from './mocks/renderer.js';
import { createMockContext, createMockPlan } from './mocks/context.js';
import { mainMenuFlow } from '../flows/main-menu.js';
import { planMenuFlow, planWizardFlow } from '../flows/plan.js';
import { runFlow } from '../flows/run.js';
import { daemonFlow } from '../flows/daemon.js';
import { requirementsFlow } from '../flows/requirements.js';
import { configFlow, mcpFlow } from '../flows/config.js';
import { executeAction, isActionMarker, getActionName } from '../action-handlers.js';
import type { FlowContext } from '../types.js';

// Mock external dependencies for action handlers
vi.mock('../../telegram/project-bridge.js', () => ({
  getRecentLogs: vi.fn(() => Promise.resolve(['log1', 'log2', 'log3'])),
  addRequirement: vi.fn(() => Promise.resolve({ id: 'new-req-id' })),
  startPlanFromApi: vi.fn(() => Promise.resolve({ success: true })),
  approvePlanFromApi: vi.fn(() => Promise.resolve({ success: true })),
  rejectPlanFromApi: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../cli/daemon.js', () => ({
  tailLogs: vi.fn(() => Promise.resolve()),
  stopDaemon: vi.fn(() => Promise.resolve({ success: true })),
  spawnDaemon: vi.fn(() => Promise.resolve({ pid: 12345 })),
}));

vi.mock('../../cli/commands/status.js', () => ({
  statusCommand: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../cli/updater.js', () => ({
  checkForUpdates: vi.fn(() => Promise.resolve({ isOutdated: false, current: '0.1.0', latest: '0.1.0' })),
  updateToLatest: vi.fn(() => Promise.resolve()),
  getCurrentVersion: vi.fn(() => '0.1.0'),
}));

describe('Integration: Flow Execution', () => {
  let renderer: MockRenderer;
  let ctx: FlowContext;

  beforeEach(() => {
    renderer = createMockRenderer();
    ctx = createMockContext();
    vi.clearAllMocks();
  });

  describe('Main Menu Flow', () => {
    it('exits on exit selection', async () => {
      renderer.selectResponses = ['exit'];
      const runner = new FlowRunner(mainMenuFlow, renderer, ctx);

      await runner.runCurrentStep();
      const result = await runner.handleResponse('exit');

      expect(result.done).toBe(true);
    });

    it('shows project name in menu', async () => {
      ctx = createMockContext({ projectName: 'my-app' });
      renderer.selectResponses = ['exit'];
      const runner = new FlowRunner(mainMenuFlow, renderer, ctx);

      await runner.runCurrentStep();

      expect(renderer.displayedMessages[0]).toContain('my-app');
    });

    it('returns flow marker for subflow navigation', async () => {
      renderer.selectResponses = ['plan'];
      const runner = new FlowRunner(mainMenuFlow, renderer, ctx);

      await runner.runCurrentStep();
      const result = await runner.handleResponse('plan');

      expect(result.done).toBe(false);
      // Handler returned 'flow:plan' - the runner stores this as the step ID
      // The caller is responsible for parsing this and navigating to the subflow
      expect(runner.getCurrentStepId()).toBe('flow:plan');
    });

    it('navigates to status and back to menu', async () => {
      renderer.selectResponses = ['status'];
      const runner = new FlowRunner(mainMenuFlow, renderer, ctx);

      // Select status from menu
      await runner.runCurrentStep();
      let result = await runner.handleResponse('status');

      expect(result.done).toBe(false);
      expect(runner.getCurrentStepId()).toBe('show_status');

      // Now the step is a progress indicator
      await runner.runCurrentStep();

      // After handle, should move to status_continue
      result = await runner.handleResponse(renderer.lastProgressHandle);
      expect(runner.getCurrentStepId()).toBe('status_continue');
    });
  });

  describe('Plan Flow', () => {
    it('shows create option when no plan', async () => {
      ctx = createMockContext({ plan: null });
      renderer.selectResponses = ['create'];
      const runner = new FlowRunner(planMenuFlow, renderer, ctx);

      await runner.runCurrentStep();

      expect(renderer.displayedMessages[0]).toContain('No active plan');
      expect(renderer.selectInteractions[0]?.options.some((o) => o.id === 'create')).toBe(true);
    });

    it('sets goal and returns action marker on create', async () => {
      ctx = createMockContext({ plan: null });
      renderer.selectResponses = ['create'];
      renderer.inputResponses = ['Build a todo app'];
      const runner = new FlowRunner(planMenuFlow, renderer, ctx);

      // Select create
      await runner.runCurrentStep();
      await runner.handleResponse('create');

      // Enter goal
      await runner.runCurrentStep();
      const result = await runner.handleResponse('Build a todo app');

      // Context should have the goal
      expect((ctx as any).planGoal).toBe('Build a todo app');

      // Result should be action marker (handler returned 'action:create_plan')
      expect(isActionMarker('action:create_plan')).toBe(true);
    });

    it('shows plan details when plan exists', async () => {
      ctx = createMockContext({
        plan: createMockPlan({
          highLevelGoal: 'Build an e-commerce platform',
          status: 'pending_approval',
          requirements: [{ id: 'r1', title: 'Auth' }] as any,
        }),
      });
      renderer.selectResponses = ['view'];
      const runner = new FlowRunner(planMenuFlow, renderer, ctx);

      await runner.runCurrentStep();

      expect(renderer.displayedMessages[0]).toContain('Build an e-commerce platform');
      expect(renderer.displayedMessages[0]).toContain('pending_approval');
    });
  });

  describe('Plan Wizard Flow', () => {
    it('advances through questions', async () => {
      ctx = createMockContext({
        plan: createMockPlan({
          questions: [
            { id: 'q1', question: 'Tech stack?', suggestedOptions: ['React', 'Vue', 'Angular'] },
            { id: 'q2', question: 'Database?', suggestedOptions: ['PostgreSQL', 'MySQL'] },
          ],
        }),
        questionIndex: 0,
      }) as any;
      renderer.selectResponses = ['opt_0', 'opt_1']; // Select React, then MySQL
      const runner = new FlowRunner(planWizardFlow, renderer, ctx as FlowContext);

      // First question
      await runner.runCurrentStep();
      expect(renderer.displayedMessages[0]).toContain('Tech stack');

      let result = await runner.handleResponse('opt_0');
      expect(result.done).toBe(false);
      expect((ctx as any).answers?.get('q1')).toBe('React');

      // Second question
      await runner.runCurrentStep();
      expect(renderer.displayedMessages[1]).toContain('Database');

      result = await runner.handleResponse('opt_1');
      expect((ctx as any).answers?.get('q2')).toBe('MySQL');
    });

    it('supports custom answers', async () => {
      ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ id: 'q1', question: 'Framework?', suggestedOptions: ['React'] }],
        }),
        questionIndex: 0,
      }) as any;
      renderer.selectResponses = ['custom'];
      renderer.inputResponses = ['Svelte'];
      const runner = new FlowRunner(planWizardFlow, renderer, ctx as FlowContext);

      // First question - select custom
      await runner.runCurrentStep();
      await runner.handleResponse('custom');

      // Custom input
      await runner.runCurrentStep();
      await runner.handleResponse('Svelte');

      expect((ctx as any).answers?.get('q1')).toBe('Svelte');
    });

    it('completes after all questions', async () => {
      ctx = createMockContext({
        plan: createMockPlan({
          questions: [{ id: 'q1', question: 'Q1?', suggestedOptions: ['A'] }],
        }),
        questionIndex: 0,
      }) as any;
      renderer.selectResponses = ['opt_0'];
      const runner = new FlowRunner(planWizardFlow, renderer, ctx as FlowContext);

      await runner.runCurrentStep();
      await runner.handleResponse('opt_0');

      // Should be at questions_complete
      expect(runner.getCurrentStepId()).toBe('questions_complete');

      // Run the display step
      await runner.runCurrentStep();
      expect(renderer.displayedMessages.some((m) => m.includes('questions answered'))).toBe(true);
    });
  });

  describe('Run Flow', () => {
    it('navigates through run configuration', async () => {
      ctx = createMockContext({
        requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
      });
      renderer.selectResponses = ['run_pending', 'foreground', '3'];
      renderer.confirmResponses = [true];
      const runner = new FlowRunner(runFlow, renderer, ctx);

      // Menu
      await runner.runCurrentStep();
      expect(renderer.displayedMessages[0]).toContain('Run requirements');
      await runner.handleResponse('run_pending');

      // Select mode
      await runner.runCurrentStep();
      expect(runner.getCurrentStepId()).toBe('select_mode');
      await runner.handleResponse('foreground');

      // Select concurrency
      await runner.runCurrentStep();
      expect(runner.getCurrentStepId()).toBe('select_concurrency');
      await runner.handleResponse('3');

      // Confirm
      expect(runner.getCurrentStepId()).toBe('confirm_run');
      await runner.runCurrentStep();

      expect((ctx as any).runMode).toBe('foreground');
      expect((ctx as any).concurrency).toBe(3);
    });

    it('can cancel at any step', async () => {
      ctx = createMockContext({
        requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
      });
      renderer.selectResponses = ['run_pending', 'back'];
      const runner = new FlowRunner(runFlow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('run_pending');

      await runner.runCurrentStep();
      await runner.handleResponse('back');

      expect(runner.getCurrentStepId()).toBe('menu');
    });
  });

  describe('Requirements Flow', () => {
    it('adds a new requirement', async () => {
      ctx = createMockContext();
      renderer.selectResponses = ['add'];
      renderer.inputResponses = ['User authentication', 'OAuth with Google'];
      renderer.confirmResponses = [true];
      const runner = new FlowRunner(requirementsFlow, renderer, ctx);

      // Menu - select add
      await runner.runCurrentStep();
      await runner.handleResponse('add');

      // Enter title
      await runner.runCurrentStep();
      expect(runner.getCurrentStepId()).toBe('add_title');
      await runner.handleResponse('User authentication');

      // Enter description
      await runner.runCurrentStep();
      expect(runner.getCurrentStepId()).toBe('add_description');
      await runner.handleResponse('OAuth with Google');

      // Confirm
      await runner.runCurrentStep();
      expect(runner.getCurrentStepId()).toBe('add_confirm');

      expect((ctx as any).newRequirementTitle).toBe('User authentication');
      expect((ctx as any).newRequirementDescription).toBe('OAuth with Google');
    });

    it('cancels requirement creation', async () => {
      ctx = createMockContext();
      renderer.selectResponses = ['add'];
      renderer.inputResponses = ['Test title', 'Test desc'];
      renderer.confirmResponses = [false];
      const runner = new FlowRunner(requirementsFlow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('add');

      await runner.runCurrentStep();
      await runner.handleResponse('Test title');

      await runner.runCurrentStep();
      await runner.handleResponse('Test desc');

      await runner.runCurrentStep();
      await runner.handleResponse(false);

      // Should be back at menu with cleared context
      expect(runner.getCurrentStepId()).toBe('menu');
      expect((ctx as any).newRequirementTitle).toBeUndefined();
      expect((ctx as any).newRequirementDescription).toBeUndefined();
    });
  });

  describe('Config Flow', () => {
    it('navigates to MCP subflow', async () => {
      ctx = createMockContext({ hasProject: true });
      renderer.selectResponses = ['mcp_servers'];
      const runner = new FlowRunner(configFlow, renderer, ctx);

      await runner.runCurrentStep();
      const result = await runner.handleResponse('mcp_servers');

      // Handler returns 'flow:mcp'
      expect(result.done).toBe(false);
    });

    it('returns action marker for project settings', async () => {
      ctx = createMockContext({ hasProject: true });
      renderer.selectResponses = ['project_settings'];
      const runner = new FlowRunner(configFlow, renderer, ctx);

      await runner.runCurrentStep();
      await runner.handleResponse('project_settings');

      // Handler returned 'action:project_settings'
      expect(isActionMarker('action:project_settings')).toBe(true);
    });
  });

  describe('MCP Flow', () => {
    it('adds an MCP server (stdio)', async () => {
      ctx = createMockContext();
      renderer.selectResponses = ['add', 'stdio'];
      renderer.inputResponses = ['vercel', 'npx', '-y @vercel/mcp'];
      renderer.confirmResponses = [true];
      const runner = new FlowRunner(mcpFlow, renderer, ctx);

      // Menu - add
      await runner.runCurrentStep();
      await runner.handleResponse('add');

      // Server name
      await runner.runCurrentStep();
      await runner.handleResponse('vercel');

      // Transport
      await runner.runCurrentStep();
      await runner.handleResponse('stdio');

      // Command
      await runner.runCurrentStep();
      await runner.handleResponse('npx');

      // Args
      await runner.runCurrentStep();
      await runner.handleResponse('-y @vercel/mcp');

      // Confirm
      expect(runner.getCurrentStepId()).toBe('add_confirm');
      expect((ctx as any).mcpServerName).toBe('vercel');
      expect((ctx as any).mcpTransport).toBe('stdio');
      expect((ctx as any).mcpCommand).toBe('npx');
      expect((ctx as any).mcpArgs).toBe('-y @vercel/mcp');
    });
  });

  describe('Daemon Flow', () => {
    it('loads and displays logs', async () => {
      ctx = createMockContext({
        daemon: { running: true, pid: 12345, startedAt: new Date().toISOString() },
      }) as any;
      (ctx as any).logs = ['Line 1', 'Line 2'];
      renderer.selectResponses = ['view_logs'];
      const runner = new FlowRunner(daemonFlow, renderer, ctx as FlowContext);

      // Menu
      await runner.runCurrentStep();
      expect(renderer.displayedMessages[0]).toContain('12345');
      const result = await runner.handleResponse('view_logs');

      // Returns action:load_logs
      expect(isActionMarker('action:load_logs')).toBe(true);
    });
  });
});

describe('Integration: Action Execution', () => {
  it('routes to correct handler', async () => {
    const ctx = createMockContext({ projectPath: '/test' });

    const result = await executeAction('load_logs', ctx, 'cli');

    expect(result.nextStep).toBeDefined();
    expect((ctx as any).logs).toBeDefined();
  });

  it('handles unknown actions gracefully', async () => {
    const ctx = createMockContext();

    const result = await executeAction('nonexistent_action', ctx, 'cli');

    // Unknown actions return to menu with an error message
    expect(result.nextStep).toBe('menu');
    expect(result.error).toContain('Unknown action');
  });

  it('platform-specific behavior works', async () => {
    const ctx = createMockContext({ projectPath: '/test' });

    // For telegram, load_logs should load into context
    const result = await executeAction('load_logs', ctx, 'telegram');

    expect(result.nextStep).toBe('display_logs');
    expect((ctx as any).logs).toBeDefined();
  });
});

describe('Integration: Full Flow with runFlowCli', () => {
  it('runs main menu to exit', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['exit'];
    const ctx = createMockContext();

    const result = await runFlowCli(mainMenuFlow, renderer, ctx);

    expect(result).toBe(ctx);
    expect(renderer.callCounts.select).toBe(1);
  });

  it('handles back navigation correctly', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['run_pending', 'back', 'back'];
    const ctx = createMockContext({
      requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
    });

    await runFlowCli(runFlow, renderer, ctx);

    // Should have gone: menu -> select_mode -> back -> menu -> back -> exit
    expect(renderer.callCounts.select).toBe(3);
  });
});

describe('Integration: Session Serialization', () => {
  it('preserves state through serialize/deserialize', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['run_pending', 'foreground'];
    const ctx = createMockContext({
      requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
    });
    const runner = new FlowRunner(runFlow, renderer, ctx);

    // Navigate partway through
    await runner.runCurrentStep();
    await runner.handleResponse('run_pending');
    await runner.runCurrentStep();
    await runner.handleResponse('foreground');

    // Serialize
    const session = runner.toSession();

    // Restore
    const restored = FlowRunner.fromSession(session, runFlow, renderer);

    expect(restored.getCurrentStepId()).toBe('select_concurrency');
    expect(restored.canGoBack()).toBe(true);
    expect((restored.getContext() as any).runMode).toBe('foreground');
  });
});

describe('Integration: Error Recovery', () => {
  it('handles step handler errors', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['opt1'];
    const ctx = createMockContext();

    // Create a flow with an error-throwing handler
    const errorFlow = {
      id: 'error-flow',
      name: 'Error Flow',
      firstStep: 'step1',
      steps: {
        step1: {
          id: 'step1',
          interaction: () => ({
            type: 'select' as const,
            message: 'Test',
            options: [{ id: 'opt1', label: 'Option 1' }],
          }),
          handle: async () => {
            throw new Error('Test error');
          },
        },
      },
    };

    const runner = new FlowRunner(errorFlow, renderer, ctx);
    await runner.runCurrentStep();
    const result = await runner.handleResponse('opt1');

    expect(result.error).toBe('Test error');
    expect(result.done).toBe(false);
  });
});

describe('Integration: Context Mutations', () => {
  it('context changes persist across steps', async () => {
    const renderer = createMockRenderer();
    renderer.selectResponses = ['add'];
    renderer.inputResponses = ['My requirement'];
    const ctx = createMockContext();
    const runner = new FlowRunner(requirementsFlow, renderer, ctx);

    // Go through add flow
    await runner.runCurrentStep();
    await runner.handleResponse('add');

    await runner.runCurrentStep();
    await runner.handleResponse('My requirement');

    // Context should have the title
    expect((ctx as any).newRequirementTitle).toBe('My requirement');
    expect(runner.getContext()).toBe(ctx);
  });

  it('updateContext merges correctly', () => {
    const renderer = createMockRenderer();
    const ctx = createMockContext({
      requirements: { pending: 5, inProgress: 0, completed: 0, failed: 0 },
    });
    const runner = new FlowRunner(mainMenuFlow, renderer, ctx);

    runner.updateContext({ projectName: 'updated-name' });

    expect(runner.getContext().projectName).toBe('updated-name');
    expect(runner.getContext().requirements.pending).toBe(5); // Unchanged
  });
});
