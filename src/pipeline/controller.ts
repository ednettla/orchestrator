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
import { AgentInvoker, type AgentResult } from '../agents/invoker.js';
import type { StateStore } from '../state/store.js';

// ============================================================================
// Pipeline Controller
// ============================================================================

interface PipelineControllerOptions {
  workingPath?: string;
  // Skip global phase updates - use when running multiple pipelines concurrently
  skipPhaseUpdates?: boolean;
}

export class PipelineController {
  private sessionManager: SessionManager;
  private store: StateStore;
  private agentInvoker: AgentInvoker;
  private workingPath: string;
  private skipPhaseUpdates: boolean;

  // Loop counters for revision limits
  private reviewLoopCount = 0;
  private testLoopCount = 0;
  private totalAgentCalls = 0;

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
    }

    this.agentInvoker = new AgentInvoker(sessionManager, this.workingPath);
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

    const task = this.store.createTask({
      sessionId: session.id,
      requirementId: requirement.id,
      agentType: 'architect',
      input: {
        structuredSpec: updatedReq.structuredSpec,
        techStack: session.techStack,
        projectPath: this.workingPath,
      },
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

    const task = this.store.createTask({
      sessionId: session.id,
      requirementId: requirement.id,
      agentType: 'coder',
      input: {
        structuredSpec: updatedReq.structuredSpec,
        techStack: session.techStack,
        projectPath: this.workingPath,
      },
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

    // Update task status
    this.store.updateTask(task.id, {
      status: 'running',
      startedAt: new Date(),
    });

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const result = await this.agentInvoker.invoke(task);

        // Update task with result
        this.store.updateTask(task.id, {
          status: 'completed',
          output: result.output,
          completedAt: new Date(),
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < RETRY_CONFIG.maxRetries) {
          const delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1),
            RETRY_CONFIG.maxDelayMs
          );
          this.log(chalk.yellow(`⚠ Attempt ${attempt} failed, retrying in ${delay}ms...`));
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    this.store.updateTask(task.id, {
      status: 'failed',
      errorMessage: lastError?.message ?? 'Unknown error',
      retryCount: RETRY_CONFIG.maxRetries,
    });

    throw lastError;
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
