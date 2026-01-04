import chalk from 'chalk';
import type { SessionManager } from '../core/session-manager.js';
import type {
  Session,
  Requirement,
  Task,
  Artifact,
  PipelinePhase,
  AgentType,
  StructuredSpec,
} from '../core/types.js';
import { LOOP_LIMITS, RETRY_CONFIG } from '../core/types.js';
import { AgentInvoker, type AgentResult, type StreamingOptions } from '../agents/invoker.js';
import { RetryableInvoker, type RetryResult } from '../agents/retry-wrapper.js';
import { AgentMonitor } from '../agents/monitor.js';
import type { StateStore } from '../state/store.js';

// ============================================================================
// Pipeline Controller
// ============================================================================

interface PipelineControllerOptions {
  workingPath?: string;
  // Skip global phase updates - use when running multiple pipelines concurrently
  skipPhaseUpdates?: boolean;
  // Agent monitor for reporting activity
  monitor?: AgentMonitor;
  // Streaming options for agent output
  streamingOptions?: StreamingOptions;
}

export class PipelineController {
  private sessionManager: SessionManager;
  private store: StateStore;
  private agentInvoker: AgentInvoker;
  private retryableInvoker: RetryableInvoker;
  private workingPath: string;
  private skipPhaseUpdates: boolean;
  private monitor?: AgentMonitor;
  private streamingOptions?: StreamingOptions;

  // Loop counters for revision limits
  private reviewLoopCount = 0;
  private testLoopCount = 0;
  private totalAgentCalls = 0;

  // Current requirement for job ID generation
  private currentRequirementId: string | null = null;

  constructor(sessionManager: SessionManager, options?: PipelineControllerOptions | string) {
    this.sessionManager = sessionManager;
    this.store = sessionManager.getStore();

    // Handle backwards compatibility: second arg was previously workingPath string
    if (typeof options === 'string') {
      this.workingPath = options;
      this.skipPhaseUpdates = false;
    } else {
      this.workingPath = options?.workingPath ?? sessionManager.getCurrentSession()?.projectPath ?? process.cwd();
      this.skipPhaseUpdates = options?.skipPhaseUpdates ?? false;
      if (options?.monitor) {
        this.monitor = options.monitor;
      }
      if (options?.streamingOptions) {
        this.streamingOptions = options.streamingOptions;
      }
    }

    this.agentInvoker = new AgentInvoker(sessionManager, this.workingPath);

    const retryOptions: { monitor?: AgentMonitor } = {};
    if (this.monitor) {
      retryOptions.monitor = this.monitor;
    }
    this.retryableInvoker = new RetryableInvoker(this.agentInvoker, retryOptions);
  }

  /**
   * Get the agent monitor (if set)
   */
  getMonitor(): AgentMonitor | undefined {
    return this.monitor;
  }

  /**
   * Kill any running agent processes
   */
  async killAll(): Promise<void> {
    await this.retryableInvoker.killAll();
  }

  private async updatePhase(phase: PipelinePhase): Promise<void> {
    // Skip phase updates when running concurrently to avoid race conditions
    if (!this.skipPhaseUpdates) {
      await this.sessionManager.updatePhase(phase);
    }
  }

  async run(requirementId: string): Promise<void> {
    const requirement = this.store.getRequirement(requirementId);
    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    // Track current requirement for job ID generation
    this.currentRequirementId = requirementId;

    // Reset loop counters
    this.reviewLoopCount = 0;
    this.testLoopCount = 0;
    this.totalAgentCalls = 0;

    // Update requirement status
    this.store.updateRequirement(requirementId, { status: 'in_progress' });

    try {
      // Run through the pipeline phases
      await this.runPlanning(session, requirement);
      await this.runArchitecting(session, requirement);
      await this.runCoding(session, requirement);
      await this.runReviewing(session, requirement);
      await this.runTesting(session, requirement);

      // Mark requirement as completed
      this.store.updateRequirement(requirementId, { status: 'completed' });
      await this.updatePhase('completed');

      this.log(chalk.green('✅ Requirement completed successfully'));
    } catch (error) {
      // Mark requirement as failed
      this.store.updateRequirement(requirementId, { status: 'failed' });
      await this.updatePhase('failed');
      throw error;
    } finally {
      this.currentRequirementId = null;
    }
  }

  // --------------------------------------------------------------------------
  // Phase: Planning
  // --------------------------------------------------------------------------

  private async runPlanning(session: Session, requirement: Requirement): Promise<void> {
    await this.updatePhase('planning');
    this.createCheckpoint(session, 'planning');

    this.log(chalk.cyan('\n📋 Phase: Planning'));
    this.log(chalk.dim('Analyzing requirement and creating structured specification...'));

    const task = this.store.createTask({
      sessionId: session.id,
      requirementId: requirement.id,
      agentType: 'planner',
      input: {
        rawRequirement: requirement.rawInput,
        techStack: session.techStack,
        projectName: session.projectName,
      },
    });

    const result = await this.runAgent(task);

    // Parse structured spec from result
    const structuredSpec = this.parseStructuredSpec(result);
    this.store.updateRequirement(requirement.id, { structuredSpec });

    this.log(chalk.green('✓ Planning complete'));
    this.log(chalk.dim(`  Title: ${structuredSpec.title}`));
    this.log(chalk.dim(`  Acceptance criteria: ${structuredSpec.acceptanceCriteria.length}`));
  }

  // --------------------------------------------------------------------------
  // Phase: Architecting
  // --------------------------------------------------------------------------

  private async runArchitecting(session: Session, requirement: Requirement): Promise<void> {
    await this.updatePhase('architecting');
    this.createCheckpoint(session, 'architecting');

    this.log(chalk.cyan('\n🏗️  Phase: Architecting'));
    this.log(chalk.dim('Designing system architecture and file structure...'));

    // Reload requirement to get structured spec
    const updatedReq = this.store.getRequirement(requirement.id)!;

    // Build input with optional design system
    const input: Record<string, unknown> = {
      structuredSpec: updatedReq.structuredSpec,
      techStack: session.techStack,
      projectPath: this.workingPath,
    };
    if (session.designSystem) {
      input.designSystem = session.designSystem;
    }

    const task = this.store.createTask({
      sessionId: session.id,
      requirementId: requirement.id,
      agentType: 'architect',
      input,
    });

    await this.runAgent(task);

    this.log(chalk.green('✓ Architecture complete'));
  }

  // --------------------------------------------------------------------------
  // Phase: Coding
  // --------------------------------------------------------------------------

  private async runCoding(session: Session, requirement: Requirement): Promise<void> {
    await this.updatePhase('coding');
    this.createCheckpoint(session, 'coding');

    this.log(chalk.cyan('\n💻 Phase: Coding'));
    this.log(chalk.dim('Implementing features...'));

    const updatedReq = this.store.getRequirement(requirement.id)!;

    // Build input with optional design system
    const input: Record<string, unknown> = {
      structuredSpec: updatedReq.structuredSpec,
      techStack: session.techStack,
      projectPath: this.workingPath,
    };
    if (session.designSystem) {
      input.designSystem = session.designSystem;
    }

    const task = this.store.createTask({
      sessionId: session.id,
      requirementId: requirement.id,
      agentType: 'coder',
      input,
    });

    await this.runAgent(task);

    this.log(chalk.green('✓ Coding complete'));
  }

  // --------------------------------------------------------------------------
  // Phase: Reviewing
  // --------------------------------------------------------------------------

  private async runReviewing(session: Session, requirement: Requirement): Promise<void> {
    await this.updatePhase('reviewing');

    while (this.reviewLoopCount < LOOP_LIMITS.reviewToCoder) {
      this.reviewLoopCount++;
      this.createCheckpoint(session, 'reviewing');

      this.log(chalk.cyan(`\n🔍 Phase: Reviewing (attempt ${this.reviewLoopCount}/${LOOP_LIMITS.reviewToCoder})`));
      this.log(chalk.dim('Reviewing code quality...'));

      const task = this.store.createTask({
        sessionId: session.id,
        requirementId: requirement.id,
        agentType: 'reviewer',
        input: {
          projectPath: this.workingPath,
          techStack: session.techStack,
        },
      });

      const result = await this.runAgent(task);

      // Check if review passed
      const reviewPassed = this.checkReviewPassed(result);

      if (reviewPassed) {
        this.log(chalk.green('✓ Review passed'));
        return;
      }

      // If we have more attempts, run coding again
      if (this.reviewLoopCount < LOOP_LIMITS.reviewToCoder) {
        this.log(chalk.yellow('⚠ Review found issues, running coder again...'));
        await this.runCodingFix(session, requirement, result);
      }
    }

    // Exceeded review loop limit
    this.log(chalk.yellow(`⚠ Review loop limit reached (${LOOP_LIMITS.reviewToCoder}). Proceeding to testing.`));
  }

  // --------------------------------------------------------------------------
  // Phase: Testing
  // --------------------------------------------------------------------------

  private async runTesting(session: Session, requirement: Requirement): Promise<void> {
    await this.updatePhase('testing');

    while (this.testLoopCount < LOOP_LIMITS.testToCoder) {
      this.testLoopCount++;
      this.createCheckpoint(session, 'testing');

      this.log(chalk.cyan(`\n🧪 Phase: Testing (attempt ${this.testLoopCount}/${LOOP_LIMITS.testToCoder})`));
      this.log(chalk.dim('Generating and running E2E tests...'));

      const updatedReq = this.store.getRequirement(requirement.id)!;

      const task = this.store.createTask({
        sessionId: session.id,
        requirementId: requirement.id,
        agentType: 'tester',
        input: {
          structuredSpec: updatedReq.structuredSpec,
          projectPath: this.workingPath,
          techStack: session.techStack,
        },
      });

      const result = await this.runAgent(task);

      // Check if tests passed
      const testsPassed = this.checkTestsPassed(result);

      if (testsPassed) {
        this.log(chalk.green('✓ All tests passed'));
        return;
      }

      // If we have more attempts, run coding fix
      if (this.testLoopCount < LOOP_LIMITS.testToCoder) {
        this.log(chalk.yellow('⚠ Tests failed, running coder to fix...'));
        await this.runCodingFix(session, requirement, result);
      }
    }

    // Exceeded test loop limit
    throw new Error(`Test loop limit reached (${LOOP_LIMITS.testToCoder}). Manual intervention required.`);
  }

  // --------------------------------------------------------------------------
  // Helper: Run Coding Fix
  // --------------------------------------------------------------------------

  private async runCodingFix(session: Session, requirement: Requirement, previousResult: AgentResult): Promise<void> {
    await this.updatePhase('coding');

    const task = this.store.createTask({
      sessionId: session.id,
      requirementId: requirement.id,
      agentType: 'coder',
      input: {
        mode: 'fix',
        issues: previousResult.output,
        projectPath: this.workingPath,
        techStack: session.techStack,
      },
    });

    await this.runAgent(task);
  }

  // --------------------------------------------------------------------------
  // Agent Execution
  // --------------------------------------------------------------------------

  private async runAgent(task: Task): Promise<AgentResult> {
    // Check total agent call limit
    this.totalAgentCalls++;
    if (this.totalAgentCalls > LOOP_LIMITS.totalAgentCallsPerRequirement) {
      throw new Error(`Total agent call limit reached (${LOOP_LIMITS.totalAgentCallsPerRequirement}). Manual intervention required.`);
    }

    // Generate job ID for monitoring
    const jobId = `${this.currentRequirementId ?? 'unknown'}-${task.agentType}-${Date.now()}`;

    // Get requirement info for monitor
    const requirement = this.currentRequirementId
      ? this.store.getRequirement(this.currentRequirementId)
      : null;

    // Report to monitor if available
    if (this.monitor && requirement) {
      const phase = this.getCurrentPhase(task.agentType);
      this.monitor.startJob(
        jobId,
        requirement.id,
        requirement.rawInput.substring(0, 50),
        phase,
        task.agentType
      );
    }

    // Update task status
    this.store.updateTask(task.id, {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      // Use retryable invoker with streaming options
      const result = await this.retryableInvoker.invoke(
        task,
        jobId,
        this.streamingOptions
      );

      // Update task with result
      this.store.updateTask(task.id, {
        status: 'completed',
        output: result.output,
        completedAt: new Date(),
        retryCount: result.retryCount,
      });

      // Report completion to monitor
      if (this.monitor) {
        this.monitor.completeJob(jobId, result.success);
      }

      return result;
    } catch (error) {
      const lastError = error instanceof Error ? error : new Error(String(error));

      // Update task as failed
      this.store.updateTask(task.id, {
        status: 'failed',
        errorMessage: lastError.message,
        retryCount: RETRY_CONFIG.maxRetries,
      });

      // Report failure to monitor
      if (this.monitor) {
        this.monitor.completeJob(jobId, false);
      }

      throw lastError;
    }
  }

  /**
   * Map agent type to pipeline phase for monitor reporting
   */
  private getCurrentPhase(agentType: AgentType): PipelinePhase {
    switch (agentType) {
      case 'planner':
      case 'decomposer':
        return 'planning';
      case 'architect':
        return 'architecting';
      case 'designer':
      case 'coder':
        return 'coding';
      case 'reviewer':
        return 'reviewing';
      case 'tester':
        return 'testing';
      default:
        return 'planning';
    }
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  private createCheckpoint(session: Session, phase: PipelinePhase): void {
    const tasks = this.store.getTasksBySession(session.id);
    const artifacts = this.store.getArtifactsBySession(session.id);

    this.store.createCheckpoint({
      sessionId: session.id,
      phase,
      taskId: tasks[tasks.length - 1]?.id ?? null,
      state: {
        completedTasks: tasks.filter((t: Task) => t.status === 'completed').map((t: Task) => t.id),
        pendingTasks: tasks.filter((t: Task) => t.status === 'pending').map((t: Task) => t.id),
        artifacts: artifacts.map((a: Artifact) => a.id),
        context: {},
      },
    });
  }

  private parseStructuredSpec(result: AgentResult): StructuredSpec {
    // The agent should return a structured spec in its output
    const output = result.output as Record<string, unknown>;

    return {
      title: (output['title'] as string) ?? 'Untitled',
      description: (output['description'] as string) ?? '',
      userStories: (output['userStories'] as string[]) ?? [],
      acceptanceCriteria: (output['acceptanceCriteria'] as StructuredSpec['acceptanceCriteria']) ?? [],
      technicalNotes: (output['technicalNotes'] as string[]) ?? [],
      dependencies: (output['dependencies'] as string[]) ?? [],
      priority: (output['priority'] as StructuredSpec['priority']) ?? 'medium',
    };
  }

  private checkReviewPassed(result: AgentResult): boolean {
    const output = result.output as Record<string, unknown>;
    return (output['passed'] as boolean) ?? false;
  }

  private checkTestsPassed(result: AgentResult): boolean {
    const output = result.output as Record<string, unknown>;
    return (output['allPassed'] as boolean) ?? false;
  }

  private log(message: string): void {
    console.log(message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
