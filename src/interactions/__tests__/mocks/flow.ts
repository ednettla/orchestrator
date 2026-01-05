/**
 * Mock Flow Factory for Testing
 *
 * Creates simple flow definitions for testing FlowRunner behavior.
 *
 * @module interactions/__tests__/mocks/flow
 */

import type { Flow, FlowStep, FlowContext, Interaction } from '../../types.js';

/**
 * Create a minimal flow with a single step
 */
export function createSingleStepFlow(
  stepConfig?: Partial<FlowStep<FlowContext>>
): Flow<FlowContext> {
  return {
    id: 'test-flow',
    name: 'Test Flow',
    firstStep: 'step1',
    steps: {
      step1: {
        id: 'step1',
        interaction: () => ({
          type: 'select',
          message: 'Test message',
          options: [
            { id: 'opt1', label: 'Option 1' },
            { id: 'opt2', label: 'Option 2' },
          ],
        }),
        handle: async () => null, // Exit flow
        ...stepConfig,
      },
    },
  };
}

/**
 * Create a linear flow with multiple steps
 */
export function createLinearFlow(stepCount: number): Flow<FlowContext> {
  const steps: Record<string, FlowStep<FlowContext>> = {};

  for (let i = 1; i <= stepCount; i++) {
    const isLast = i === stepCount;
    steps[`step${i}`] = {
      id: `step${i}`,
      interaction: () => ({
        type: 'select',
        message: `Step ${i} message`,
        options: [
          { id: 'next', label: 'Next' },
          { id: 'back', label: 'Back' },
        ],
      }),
      handle: async (response) => {
        if (response === 'back') return 'back';
        if (response === 'next') return isLast ? null : `step${i + 1}`;
        return null;
      },
    };
  }

  return {
    id: 'linear-flow',
    name: 'Linear Flow',
    firstStep: 'step1',
    steps,
  };
}

/**
 * Create a flow with different interaction types
 */
export function createMixedInteractionFlow(): Flow<FlowContext> {
  return {
    id: 'mixed-flow',
    name: 'Mixed Flow',
    firstStep: 'select_step',
    steps: {
      select_step: {
        id: 'select_step',
        interaction: () => ({
          type: 'select',
          message: 'Select an option',
          options: [
            { id: 'input', label: 'Go to input' },
            { id: 'confirm', label: 'Go to confirm' },
            { id: 'progress', label: 'Go to progress' },
            { id: 'display', label: 'Go to display' },
          ],
        }),
        handle: async (response) => {
          switch (response) {
            case 'input': return 'input_step';
            case 'confirm': return 'confirm_step';
            case 'progress': return 'progress_step';
            case 'display': return 'display_step';
            default: return null;
          }
        },
      },
      input_step: {
        id: 'input_step',
        interaction: () => ({
          type: 'input',
          message: 'Enter some text',
          placeholder: 'Type here...',
        }),
        handle: async (response, ctx) => {
          (ctx as FlowContext & { userInput?: string }).userInput = response as string;
          return null;
        },
      },
      confirm_step: {
        id: 'confirm_step',
        interaction: () => ({
          type: 'confirm',
          message: 'Are you sure?',
          confirmLabel: 'Yes',
          cancelLabel: 'No',
        }),
        handle: async (response, ctx) => {
          (ctx as FlowContext & { confirmed?: boolean }).confirmed = response as boolean;
          return null;
        },
      },
      progress_step: {
        id: 'progress_step',
        interaction: () => ({
          type: 'progress',
          message: 'Loading...',
        }),
        handle: async (response, ctx) => {
          // Progress handle is passed as response
          const handle = response as { succeed: (msg?: string) => void };
          handle.succeed('Done!');
          return null;
        },
      },
      display_step: {
        id: 'display_step',
        interaction: () => ({
          type: 'display',
          message: 'This is a message',
          format: 'info',
        }),
        handle: async () => null,
      },
    },
  };
}

/**
 * Create a flow with action markers
 */
export function createActionFlow(): Flow<FlowContext> {
  return {
    id: 'action-flow',
    name: 'Action Flow',
    firstStep: 'menu',
    steps: {
      menu: {
        id: 'menu',
        interaction: () => ({
          type: 'select',
          message: 'Select action',
          options: [
            { id: 'action1', label: 'Action 1' },
            { id: 'action2', label: 'Action 2' },
            { id: 'exit', label: 'Exit' },
          ],
        }),
        handle: async (response) => {
          switch (response) {
            case 'action1': return 'action:do_action1';
            case 'action2': return 'action:do_action2';
            case 'exit': return null;
            default: return 'menu';
          }
        },
      },
    },
  };
}

/**
 * Create a flow with sub-flow navigation
 */
export function createSubFlowNavigationFlow(): Flow<FlowContext> {
  return {
    id: 'nav-flow',
    name: 'Navigation Flow',
    firstStep: 'menu',
    steps: {
      menu: {
        id: 'menu',
        interaction: () => ({
          type: 'select',
          message: 'Select sub-flow',
          options: [
            { id: 'flow1', label: 'Sub Flow 1' },
            { id: 'flow2', label: 'Sub Flow 2' },
            { id: 'exit', label: 'Exit' },
          ],
        }),
        handle: async (response) => {
          switch (response) {
            case 'flow1': return 'flow:sub-flow-1';
            case 'flow2': return 'flow:sub-flow-2';
            case 'exit': return null;
            default: return 'menu';
          }
        },
      },
    },
  };
}

/**
 * Create a flow with conditional options
 */
export function createConditionalFlow(): Flow<FlowContext> {
  return {
    id: 'conditional-flow',
    name: 'Conditional Flow',
    firstStep: 'menu',
    steps: {
      menu: {
        id: 'menu',
        interaction: (ctx) => ({
          type: 'select',
          message: 'Menu',
          options: [
            // Always show
            { id: 'always', label: 'Always visible' },
            // Only show if has project
            ...(ctx.hasProject ? [{ id: 'project', label: 'Project action' }] : []),
            // Only show if daemon running
            ...(ctx.daemon.running ? [{ id: 'daemon', label: 'Daemon controls' }] : []),
            // Only show if has pending requirements
            ...(ctx.requirements.pending > 0
              ? [{ id: 'run', label: `Run (${ctx.requirements.pending} pending)` }]
              : []),
          ],
        }),
        handle: async (response) => {
          if (response === 'always') return null;
          return 'menu';
        },
      },
    },
  };
}

/**
 * Create an empty flow (for edge case testing)
 */
export function createEmptyFlow(): Flow<FlowContext> {
  return {
    id: 'empty-flow',
    name: 'Empty Flow',
    firstStep: 'nonexistent',
    steps: {},
  };
}

/**
 * Create a flow where step returns null interaction
 */
export function createNullInteractionFlow(): Flow<FlowContext> {
  return {
    id: 'null-interaction-flow',
    name: 'Null Interaction Flow',
    firstStep: 'step1',
    steps: {
      step1: {
        id: 'step1',
        interaction: () => null,
        handle: async () => null,
      },
    },
  };
}

/**
 * Create a flow with onBack hooks
 */
export function createFlowWithOnBack(): Flow<FlowContext & { cleanupCalled?: boolean }> {
  return {
    id: 'onback-flow',
    name: 'OnBack Flow',
    firstStep: 'step1',
    steps: {
      step1: {
        id: 'step1',
        interaction: () => ({
          type: 'select',
          message: 'Step 1',
          options: [{ id: 'next', label: 'Next' }],
        }),
        handle: async () => 'step2',
        onBack: (ctx) => {
          ctx.cleanupCalled = true;
        },
      },
      step2: {
        id: 'step2',
        interaction: () => ({
          type: 'select',
          message: 'Step 2',
          options: [
            { id: 'back', label: 'Back' },
            { id: 'exit', label: 'Exit' },
          ],
        }),
        handle: async (response) => {
          if (response === 'back') return 'back';
          return null;
        },
      },
    },
  };
}
