import { nanoid } from 'nanoid';
import type { SessionManager } from '../core/session-manager.js';
import type {
  Plan,
  ClarifyingQuestion,
  PlannedRequirement,
  ArchitecturalDecision,
  Risk,
  QuestionCategory,
} from '../core/types.js';
import { AgentInvoker } from '../agents/invoker.js';

// ============================================================================
// Plan Controller
// ============================================================================

export class PlanController {
  private sessionManager: SessionManager;
  private invoker: AgentInvoker;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.invoker = new AgentInvoker(sessionManager);
  }

  /**
   * Create a new plan from a high-level goal
   */
  async createPlan(highLevelGoal: string): Promise<Plan> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const store = this.sessionManager.getStore();
    const plan = store.createPlan({
      sessionId: session.id,
      highLevelGoal,
    });

    return plan;
  }

  /**
   * Generate clarifying questions for a plan
   */
  async generateQuestions(planId: string): Promise<ClarifyingQuestion[]> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const store = this.sessionManager.getStore();
    const plan = store.getPlan(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    // Update status to questioning
    store.updatePlan(planId, { status: 'questioning' });

    // Create a decomposer task to generate questions
    const task = store.createTask({
      sessionId: session.id,
      requirementId: null,
      agentType: 'decomposer',
      input: {
        mode: 'questions',
        highLevelGoal: plan.highLevelGoal,
        techStack: session.techStack,
        projectName: session.projectName,
      },
    });

    // Invoke the decomposer agent
    const result = await this.invoker.invoke(task);

    if (!result.success) {
      store.updateTask(task.id, {
        status: 'failed',
        errorMessage: result.output['error'] as string || 'Failed to generate questions',
      });
      throw new Error('Failed to generate questions');
    }

    // Parse questions from output
    const output = result.output as { questions?: QuestionOutput[] };
    const questions: ClarifyingQuestion[] = (output.questions ?? []).map(q => {
      const question: ClarifyingQuestion = {
        id: q.id || nanoid(8),
        category: (q.category || 'scope') as QuestionCategory,
        question: q.question,
        context: q.context || '',
      };
      if (q.suggestedOptions) {
        question.suggestedOptions = q.suggestedOptions;
      }
      return question;
    });

    // Update plan with questions
    store.updatePlan(planId, { questions });

    // Mark task as completed
    store.updateTask(task.id, {
      status: 'completed',
      output: result.output,
      completedAt: new Date(),
    });

    return questions;
  }

  /**
   * Record an answer to a clarifying question
   */
  answerQuestion(planId: string, questionId: string, answer: string): Plan {
    const store = this.sessionManager.getStore();
    const plan = store.getPlan(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    const questions = plan.questions.map(q => {
      if (q.id === questionId) {
        return { ...q, answer, answeredAt: new Date() };
      }
      return q;
    });

    return store.updatePlan(planId, { questions });
  }

  /**
   * Generate the full plan based on answered questions
   */
  async generatePlan(planId: string): Promise<Plan> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const store = this.sessionManager.getStore();
    const plan = store.getPlan(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    // Update status to drafting
    store.updatePlan(planId, { status: 'drafting' });

    // Create a decomposer task to generate the plan
    const task = store.createTask({
      sessionId: session.id,
      requirementId: null,
      agentType: 'decomposer',
      input: {
        mode: 'plan',
        highLevelGoal: plan.highLevelGoal,
        techStack: session.techStack,
        projectName: session.projectName,
        questions: plan.questions,
      },
    });

    // Invoke the decomposer agent
    const result = await this.invoker.invoke(task);

    if (!result.success) {
      store.updateTask(task.id, {
        status: 'failed',
        errorMessage: result.output['error'] as string || 'Failed to generate plan',
      });
      throw new Error('Failed to generate plan');
    }

    // Parse plan output
    const output = result.output as PlanOutput;

    // Convert output to typed structures
    const requirements: PlannedRequirement[] = (output.requirements ?? []).map(r => ({
      id: r.id || nanoid(8),
      title: r.title,
      description: r.description,
      userStories: r.userStories ?? [],
      acceptanceCriteria: (r.acceptanceCriteria ?? []).map(ac => ({
        id: ac.id || nanoid(8),
        description: ac.description,
        testable: ac.testable ?? true,
        verified: false,
      })),
      technicalNotes: r.technicalNotes ?? [],
      estimatedComplexity: r.estimatedComplexity || 'medium',
      dependencies: r.dependencies ?? [],
      priority: r.priority ?? 0,
      rationale: r.rationale ?? '',
    }));

    const architecturalDecisions: ArchitecturalDecision[] = (output.architecturalDecisions ?? []).map(ad => ({
      id: ad.id || nanoid(8),
      title: ad.title,
      decision: ad.decision,
      rationale: ad.rationale,
      alternatives: ad.alternatives ?? [],
      tradeoffs: ad.tradeoffs ?? '',
    }));

    const risks: Risk[] = (output.risks ?? []).map(r => ({
      id: r.id || nanoid(8),
      description: r.description,
      likelihood: r.likelihood || 'medium',
      impact: r.impact || 'medium',
      mitigation: r.mitigation ?? '',
    }));

    // Update plan with generated content
    const updatedPlan = store.updatePlan(planId, {
      status: 'pending_approval',
      requirements,
      architecturalDecisions,
      implementationOrder: output.implementationOrder ?? requirements.map(r => r.id),
      overview: output.overview ?? '',
      assumptions: output.assumptions ?? [],
      outOfScope: output.outOfScope ?? [],
      risks,
    });

    // Mark task as completed
    store.updateTask(task.id, {
      status: 'completed',
      output: result.output,
      completedAt: new Date(),
    });

    return updatedPlan;
  }

  /**
   * Approve a plan and prepare for execution
   */
  approvePlan(planId: string): Plan {
    const store = this.sessionManager.getStore();
    const plan = store.getPlan(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.status !== 'pending_approval') {
      throw new Error(`Plan cannot be approved from status: ${plan.status}`);
    }

    return store.updatePlan(planId, {
      status: 'approved',
      approvedAt: new Date(),
    });
  }

  /**
   * Reject a plan
   */
  rejectPlan(planId: string): Plan {
    const store = this.sessionManager.getStore();
    const plan = store.getPlan(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    return store.updatePlan(planId, { status: 'rejected' });
  }

  /**
   * Convert approved plan requirements to actual Requirement records
   * These can then be executed by the concurrent runner
   */
  async convertToRequirements(planId: string): Promise<string[]> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const store = this.sessionManager.getStore();
    const plan = store.getPlan(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.status !== 'approved') {
      throw new Error('Plan must be approved before converting to requirements');
    }

    // Update plan status to executing
    store.updatePlan(planId, { status: 'executing' });

    const requirementIds: string[] = [];

    // Create requirements in implementation order
    for (const reqId of plan.implementationOrder) {
      const plannedReq = plan.requirements.find(r => r.id === reqId);
      if (!plannedReq) continue;

      // Create the requirement with pre-populated structured spec
      const requirement = store.createRequirement({
        sessionId: session.id,
        rawInput: `${plannedReq.title}: ${plannedReq.description}`,
        priority: plannedReq.priority,
      });

      // Pre-populate the structured spec so we skip the planner phase
      store.updateRequirement(requirement.id, {
        structuredSpec: {
          title: plannedReq.title,
          description: plannedReq.description,
          userStories: plannedReq.userStories,
          acceptanceCriteria: plannedReq.acceptanceCriteria,
          technicalNotes: plannedReq.technicalNotes,
          dependencies: plannedReq.dependencies,
          priority: plannedReq.estimatedComplexity === 'high' ? 'high' :
                   plannedReq.estimatedComplexity === 'medium' ? 'medium' : 'low',
        },
      });

      requirementIds.push(requirement.id);
    }

    return requirementIds;
  }

  /**
   * Get a plan by ID
   */
  getPlan(planId: string): Plan | null {
    const store = this.sessionManager.getStore();
    return store.getPlan(planId);
  }

  /**
   * Get the active plan for the current session
   */
  getActivePlan(): Plan | null {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return null;
    }

    const store = this.sessionManager.getStore();
    return store.getActivePlan(session.id);
  }
}

// ============================================================================
// Output Types (from decomposer agent)
// ============================================================================

interface QuestionOutput {
  id?: string;
  category?: string;
  question: string;
  context?: string;
  suggestedOptions?: string[];
}

interface AcceptanceCriterionOutput {
  id?: string;
  description: string;
  testable?: boolean;
}

interface RequirementOutput {
  id?: string;
  title: string;
  description: string;
  userStories?: string[];
  acceptanceCriteria?: AcceptanceCriterionOutput[];
  technicalNotes?: string[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
  dependencies?: string[];
  priority?: number;
  rationale?: string;
}

interface ArchitecturalDecisionOutput {
  id?: string;
  title: string;
  decision: string;
  rationale: string;
  alternatives?: string[];
  tradeoffs?: string;
}

interface RiskOutput {
  id?: string;
  description: string;
  likelihood?: 'low' | 'medium' | 'high';
  impact?: 'low' | 'medium' | 'high';
  mitigation?: string;
}

interface PlanOutput {
  overview?: string;
  requirements?: RequirementOutput[];
  architecturalDecisions?: ArchitecturalDecisionOutput[];
  implementationOrder?: string[];
  assumptions?: string[];
  outOfScope?: string[];
  risks?: RiskOutput[];
}
