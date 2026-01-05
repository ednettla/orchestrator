/**
 * Flow Runner
 *
 * Executes flows by rendering interactions and handling responses.
 * Platform-agnostic - works with any Renderer implementation.
 *
 * @module interactions/runner
 */

import type {
  Flow,
  FlowContext,
  FlowStep,
  FlowSession,
  Renderer,
  Interaction,
  ProgressHandle,
} from './types.js';

/**
 * Result of running a flow step
 */
export interface StepResult {
  /** Whether the flow is complete */
  done: boolean;
  /** Error message if step failed */
  error?: string;
}

/**
 * Flow Runner - executes flows step by step
 *
 * Handles:
 * - Rendering interactions via the provided renderer
 * - Processing responses and advancing to next step
 * - Back navigation via step history
 * - Serialization for persistence (Telegram)
 */
export class FlowRunner<TContext extends FlowContext = FlowContext> {
  private flow: Flow<TContext>;
  private renderer: Renderer;
  private context: TContext;

  private currentStepId: string;
  private stepHistory: string[] = [];
  private startedAt: Date;

  constructor(flow: Flow<TContext>, renderer: Renderer, context: TContext) {
    this.flow = flow;
    this.renderer = renderer;
    this.context = context;
    this.currentStepId = flow.firstStep;
    this.startedAt = new Date();
  }

  /**
   * Get the current flow context
   */
  getContext(): TContext {
    return this.context;
  }

  /**
   * Update the flow context
   */
  updateContext(updates: Partial<TContext>): void {
    Object.assign(this.context, updates);
  }

  /**
   * Get the current step ID
   */
  getCurrentStepId(): string {
    return this.currentStepId;
  }

  /**
   * Get the current step definition
   */
  getCurrentStep(): FlowStep<TContext> | null {
    return this.flow.steps[this.currentStepId] ?? null;
  }

  /**
   * Check if back navigation is available
   */
  canGoBack(): boolean {
    return this.stepHistory.length > 0;
  }

  /**
   * Serialize the current state for persistence
   */
  toSession(): FlowSession {
    return {
      flowId: this.flow.id,
      currentStepId: this.currentStepId,
      stepHistory: [...this.stepHistory],
      context: this.context,
      startedAt: this.startedAt,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min timeout
    };
  }

  /**
   * Restore state from a session
   */
  static fromSession<T extends FlowContext>(
    session: FlowSession,
    flow: Flow<T>,
    renderer: Renderer
  ): FlowRunner<T> {
    const runner = new FlowRunner(flow, renderer, session.context as T);
    runner.currentStepId = session.currentStepId;
    runner.stepHistory = [...session.stepHistory];
    runner.startedAt = session.startedAt;
    return runner;
  }

  /**
   * Run the current step (render interaction)
   *
   * For CLI: This renders and waits for response, then returns
   * For Telegram: This renders and returns immediately (response comes via callback)
   *
   * @returns The user's response (CLI) or null (Telegram async)
   */
  async runCurrentStep(): Promise<unknown> {
    const step = this.getCurrentStep();
    if (!step) {
      return null;
    }

    const interaction = step.interaction(this.context);
    if (!interaction) {
      return null;
    }

    return this.renderInteraction(interaction);
  }

  /**
   * Handle a response and advance to the next step
   *
   * @param response - User's response
   * @returns StepResult indicating if flow is done
   */
  async handleResponse(response: unknown): Promise<StepResult> {
    const step = this.getCurrentStep();
    if (!step) {
      return { done: true, error: 'No current step' };
    }

    try {
      // Handle special responses
      if (response === 'back' || response === '__back__') {
        return this.goBack();
      }

      // Process the response
      const nextStepId = await step.handle(response, this.context);

      if (nextStepId === null) {
        // Flow complete
        return { done: true };
      }

      if (nextStepId === 'back') {
        return this.goBack();
      }

      // Advance to next step
      this.stepHistory.push(this.currentStepId);
      this.currentStepId = nextStepId;

      return { done: false };
    } catch (error) {
      return {
        done: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Go back to the previous step
   */
  private goBack(): StepResult {
    if (this.stepHistory.length === 0) {
      return { done: true }; // Exit flow if no history
    }

    const previousStepId = this.stepHistory.pop()!;
    const previousStep = this.flow.steps[previousStepId];

    // Call onBack hook if present
    if (previousStep?.onBack) {
      previousStep.onBack(this.context);
    }

    this.currentStepId = previousStepId;
    return { done: false };
  }

  /**
   * Render an interaction using the renderer
   */
  private async renderInteraction(interaction: Interaction): Promise<unknown> {
    switch (interaction.type) {
      case 'select':
        return this.renderer.select(interaction);

      case 'input':
        return this.renderer.input(interaction);

      case 'confirm':
        return this.renderer.confirm(interaction);

      case 'progress':
        // Progress is special - returns a handle, not a response
        return this.renderer.progress(interaction);

      case 'display':
        await this.renderer.display(interaction);
        return null;

      default:
        return null;
    }
  }

  /**
   * Run the flow in CLI mode (synchronous loop)
   *
   * For CLI, we can run a loop that:
   * 1. Shows current step
   * 2. Waits for response
   * 3. Handles response
   * 4. Repeats until done
   */
  async runCliLoop(): Promise<void> {
    while (true) {
      const response = await this.runCurrentStep();

      // Handle null response (cancelled or display-only)
      if (response === null) {
        const step = this.getCurrentStep();
        const interaction = step?.interaction(this.context);

        if (interaction?.type === 'display') {
          // Display-only step - auto-advance
          const result = await this.handleResponse(null);
          if (result.done) break;
          continue;
        }

        // User cancelled
        break;
      }

      // Handle progress interaction differently
      if (response && typeof response === 'object' && 'update' in response) {
        // This is a ProgressHandle - the step handler should use it
        const handle = response as ProgressHandle;
        try {
          const result = await this.handleResponse(handle);
          if (result.done) break;
          if (result.error) {
            handle.fail(result.error);
          }
        } catch (error) {
          handle.fail(error instanceof Error ? error.message : 'Unknown error');
          break;
        }
        continue;
      }

      const result = await this.handleResponse(response);
      if (result.done) break;

      if (result.error) {
        await this.renderer.display({
          type: 'display',
          message: result.error,
          format: 'error',
        });
      }
    }
  }
}

/**
 * Create and run a flow in CLI mode
 *
 * Convenience function for simple CLI usage
 */
export async function runFlowCli<TContext extends FlowContext>(
  flow: Flow<TContext>,
  renderer: Renderer,
  context: TContext
): Promise<TContext> {
  const runner = new FlowRunner(flow, renderer, context);
  await runner.runCliLoop();
  return runner.getContext();
}
