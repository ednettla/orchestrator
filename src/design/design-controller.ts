import { nanoid } from 'nanoid';
import type { SessionManager } from '../core/session-manager.js';
import type { Task, TechStack } from '../core/types.js';
import { AgentInvoker } from '../agents/invoker.js';

// ============================================================================
// Types
// ============================================================================

export interface DesignGenerationResult {
  success: boolean;
  filesCreated: string[];
  components: string[];
  storybookSetup: boolean;
  notes: string[];
  error?: string;
}

export interface DesignIssue {
  id: string;
  category: 'color' | 'typography' | 'spacing' | 'pattern' | 'code-quality';
  severity: 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  description: string;
  currentValue?: string;
  suggestedValue?: string;
  autoFixable: boolean;
}

export interface DesignAuditResult {
  success: boolean;
  summary: {
    totalIssues: number;
    bySeverity: { high: number; medium: number; low: number };
    byCategory: Record<string, number>;
  };
  issues: DesignIssue[];
  recommendations: string[];
  existingPatterns: {
    hasDesignSystem: boolean;
    hasTheme: boolean;
    stylingApproach: string;
  };
  error?: string;
}

export interface DesignFixResult {
  success: boolean;
  fixesApplied: number;
  filesModified: string[];
  tokensCreated: string[];
  issuesRemaining: DesignIssue[];
  notes: string[];
  error?: string;
}

// ============================================================================
// Design Controller
// ============================================================================

export class DesignController {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Generate a design system for a new project
   * Called during `orchestrate init`
   */
  async generateDesignSystem(
    projectPath: string,
    techStack: TechStack
  ): Promise<DesignGenerationResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: 'No active session',
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'generate',
        techStack,
        projectPath,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          filesCreated: [],
          components: [],
          storybookSetup: false,
          notes: [],
          error: 'Design generation failed',
        };
      }

      const output = result.output as unknown as Partial<DesignGenerationResult>;
      return {
        success: output.success ?? true,
        filesCreated: output.filesCreated ?? [],
        components: output.components ?? [],
        storybookSetup: output.storybookSetup ?? false,
        notes: output.notes ?? [],
      };
    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Audit an existing project for design inconsistencies
   * Called during `orchestrate design` or `orchestrate design --audit`
   */
  async auditDesign(
    projectPath: string,
    techStack: TechStack
  ): Promise<DesignAuditResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        summary: {
          totalIssues: 0,
          bySeverity: { high: 0, medium: 0, low: 0 },
          byCategory: {},
        },
        issues: [],
        recommendations: [],
        existingPatterns: {
          hasDesignSystem: false,
          hasTheme: false,
          stylingApproach: 'unknown',
        },
        error: 'No active session',
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'audit',
        techStack,
        projectPath,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          summary: {
            totalIssues: 0,
            bySeverity: { high: 0, medium: 0, low: 0 },
            byCategory: {},
          },
          issues: [],
          recommendations: [],
          existingPatterns: {
            hasDesignSystem: false,
            hasTheme: false,
            stylingApproach: 'unknown',
          },
          error: 'Design audit failed',
        };
      }

      const output = result.output as unknown as Partial<DesignAuditResult>;
      return {
        success: true,
        summary: output.summary ?? {
          totalIssues: 0,
          bySeverity: { high: 0, medium: 0, low: 0 },
          byCategory: {},
        },
        issues: output.issues ?? [],
        recommendations: output.recommendations ?? [],
        existingPatterns: output.existingPatterns ?? {
          hasDesignSystem: false,
          hasTheme: false,
          stylingApproach: 'unknown',
        },
      };
    } catch (error) {
      return {
        success: false,
        summary: {
          totalIssues: 0,
          bySeverity: { high: 0, medium: 0, low: 0 },
          byCategory: {},
        },
        issues: [],
        recommendations: [],
        existingPatterns: {
          hasDesignSystem: false,
          hasTheme: false,
          stylingApproach: 'unknown',
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply fixes for identified design issues
   * Called during `orchestrate design --fix` or after audit approval
   */
  async applyFixes(
    projectPath: string,
    techStack: TechStack,
    issues: DesignIssue[]
  ): Promise<DesignFixResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        fixesApplied: 0,
        filesModified: [],
        tokensCreated: [],
        issuesRemaining: issues,
        notes: [],
        error: 'No active session',
      };
    }

    // Filter to only auto-fixable issues
    const fixableIssues = issues.filter((i) => i.autoFixable);

    if (fixableIssues.length === 0) {
      return {
        success: true,
        fixesApplied: 0,
        filesModified: [],
        tokensCreated: [],
        issuesRemaining: issues,
        notes: ['No auto-fixable issues found'],
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'fix',
        techStack,
        projectPath,
        issues: fixableIssues,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          fixesApplied: 0,
          filesModified: [],
          tokensCreated: [],
          issuesRemaining: issues,
          notes: [],
          error: 'Fix application failed',
        };
      }

      const output = result.output as unknown as Partial<DesignFixResult>;
      return {
        success: output.success ?? true,
        fixesApplied: output.fixesApplied ?? 0,
        filesModified: output.filesModified ?? [],
        tokensCreated: output.tokensCreated ?? [],
        issuesRemaining: output.issuesRemaining ?? [],
        notes: output.notes ?? [],
      };
    } catch (error) {
      return {
        success: false,
        fixesApplied: 0,
        filesModified: [],
        tokensCreated: [],
        issuesRemaining: issues,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate or update a specific component
   * Called with `orchestrate design --component Button`
   */
  async generateComponent(
    projectPath: string,
    techStack: TechStack,
    componentName: string
  ): Promise<DesignGenerationResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: 'No active session',
      };
    }

    const invoker = new AgentInvoker(this.sessionManager, projectPath);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'designer',
      input: {
        mode: 'generate',
        techStack,
        projectPath,
        singleComponent: componentName,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    try {
      const result = await invoker.invoke(task);

      if (!result.success) {
        return {
          success: false,
          filesCreated: [],
          components: [],
          storybookSetup: false,
          notes: [],
          error: `Failed to generate component: ${componentName}`,
        };
      }

      const output = result.output as unknown as Partial<DesignGenerationResult>;
      return {
        success: output.success ?? true,
        filesCreated: output.filesCreated ?? [],
        components: output.components ?? [componentName],
        storybookSetup: output.storybookSetup ?? false,
        notes: output.notes ?? [],
      };
    } catch (error) {
      return {
        success: false,
        filesCreated: [],
        components: [],
        storybookSetup: false,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDesignController(sessionManager: SessionManager): DesignController {
  return new DesignController(sessionManager);
}
