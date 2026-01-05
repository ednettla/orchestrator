/**
 * Mock Renderer for Testing
 *
 * A configurable mock renderer that:
 * - Records all interactions displayed
 * - Returns pre-configured responses
 * - Tracks progress handle calls
 *
 * @module interactions/__tests__/mocks/renderer
 */

import type {
  Renderer,
  SelectInteraction,
  InputInteraction,
  ConfirmInteraction,
  ProgressInteraction,
  DisplayInteraction,
  ProgressHandle,
} from '../../types.js';

/**
 * Extended mock renderer with test utilities
 */
export interface MockRenderer extends Renderer {
  /** Pre-configured responses for select interactions */
  selectResponses: (string | null)[];
  /** Pre-configured responses for input interactions */
  inputResponses: (string | null)[];
  /** Pre-configured responses for confirm interactions */
  confirmResponses: boolean[];

  /** All messages displayed (select messages, input prompts, display messages) */
  displayedMessages: string[];
  /** All select interactions with their options */
  selectInteractions: SelectInteraction[];
  /** All input interactions */
  inputInteractions: InputInteraction[];
  /** All confirm interactions */
  confirmInteractions: ConfirmInteraction[];
  /** All progress messages */
  progressMessages: string[];
  /** All display interactions */
  displayInteractions: DisplayInteraction[];

  /** Number of times each renderer method was called */
  callCounts: {
    select: number;
    input: number;
    confirm: number;
    progress: number;
    display: number;
  };

  /** Reset all state */
  reset(): void;

  /** Get the last progress handle created */
  lastProgressHandle: MockProgressHandle | null;
}

/**
 * Mock progress handle that tracks all calls
 */
export interface MockProgressHandle extends ProgressHandle {
  updates: string[];
  succeedMessage: string | null;
  failMessage: string | null;
  stopped: boolean;
}

/**
 * Create a mock renderer for testing
 *
 * @example
 * ```typescript
 * const renderer = createMockRenderer();
 * renderer.selectResponses = ['option1', 'option2'];
 * renderer.confirmResponses = [true, false];
 *
 * // Run flow...
 *
 * expect(renderer.displayedMessages).toContain('What would you like to do?');
 * expect(renderer.callCounts.select).toBe(2);
 * ```
 */
export function createMockRenderer(): MockRenderer {
  let lastProgressHandle: MockProgressHandle | null = null;

  const renderer: MockRenderer = {
    selectResponses: [],
    inputResponses: [],
    confirmResponses: [],
    displayedMessages: [],
    selectInteractions: [],
    inputInteractions: [],
    confirmInteractions: [],
    progressMessages: [],
    displayInteractions: [],
    callCounts: {
      select: 0,
      input: 0,
      confirm: 0,
      progress: 0,
      display: 0,
    },
    lastProgressHandle: null,

    async select(interaction: SelectInteraction): Promise<string | null> {
      renderer.callCounts.select++;
      renderer.displayedMessages.push(interaction.message);
      renderer.selectInteractions.push(interaction);
      return renderer.selectResponses.shift() ?? null;
    },

    async input(interaction: InputInteraction): Promise<string | null> {
      renderer.callCounts.input++;
      renderer.displayedMessages.push(interaction.message);
      renderer.inputInteractions.push(interaction);
      return renderer.inputResponses.shift() ?? null;
    },

    async confirm(interaction: ConfirmInteraction): Promise<boolean> {
      renderer.callCounts.confirm++;
      renderer.displayedMessages.push(interaction.message);
      renderer.confirmInteractions.push(interaction);
      return renderer.confirmResponses.shift() ?? false;
    },

    progress(interaction: ProgressInteraction): ProgressHandle {
      renderer.callCounts.progress++;
      renderer.progressMessages.push(interaction.message);

      const handle: MockProgressHandle = {
        updates: [],
        succeedMessage: null,
        failMessage: null,
        stopped: false,

        update(message: string): void {
          handle.updates.push(message);
          renderer.progressMessages.push(message);
        },

        succeed(message?: string): void {
          handle.succeedMessage = message ?? interaction.message;
          renderer.progressMessages.push(`✓ ${message ?? interaction.message}`);
        },

        fail(message?: string): void {
          handle.failMessage = message ?? interaction.message;
          renderer.progressMessages.push(`✗ ${message ?? interaction.message}`);
        },

        stop(): void {
          handle.stopped = true;
        },
      };

      lastProgressHandle = handle;
      renderer.lastProgressHandle = handle;
      return handle;
    },

    async display(interaction: DisplayInteraction): Promise<void> {
      renderer.callCounts.display++;
      renderer.displayedMessages.push(interaction.message);
      renderer.displayInteractions.push(interaction);
    },

    reset(): void {
      renderer.selectResponses = [];
      renderer.inputResponses = [];
      renderer.confirmResponses = [];
      renderer.displayedMessages = [];
      renderer.selectInteractions = [];
      renderer.inputInteractions = [];
      renderer.confirmInteractions = [];
      renderer.progressMessages = [];
      renderer.displayInteractions = [];
      renderer.callCounts = {
        select: 0,
        input: 0,
        confirm: 0,
        progress: 0,
        display: 0,
      };
      renderer.lastProgressHandle = null;
      lastProgressHandle = null;
    },
  };

  return renderer;
}

/**
 * Create a renderer that throws errors (for testing error handling)
 */
export function createErrorRenderer(errorMessage = 'Renderer error'): Renderer {
  return {
    async select(): Promise<string | null> {
      throw new Error(errorMessage);
    },
    async input(): Promise<string | null> {
      throw new Error(errorMessage);
    },
    async confirm(): Promise<boolean> {
      throw new Error(errorMessage);
    },
    progress(): ProgressHandle {
      throw new Error(errorMessage);
    },
    async display(): Promise<void> {
      throw new Error(errorMessage);
    },
  };
}
