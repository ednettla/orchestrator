/**
 * Core Types and Schemas
 *
 * This module defines all TypeScript types and Zod schemas used throughout
 * the orchestrator. It includes:
 *
 * - TechStack: Supported technology combinations
 * - Session: Project session state
 * - Requirement: User requirements and specs
 * - Task: Agent execution units
 * - Artifact: Generated file references
 * - Checkpoint: Pipeline state for resume
 * - Plan: Autonomous planning data
 * - Agent configurations and loop limits
 *
 * @module types
 */

import { z } from 'zod';

// ============================================================================
// Tech Stack Types
// ============================================================================

export const TechStackSchema = z.object({
  frontend: z.enum(['nextjs', 'react', 'vue', 'svelte']),
  backend: z.enum(['express', 'fastify', 'nestjs', 'hono']),
  database: z.enum(['postgresql', 'sqlite', 'mongodb', 'supabase']),
  testing: z.enum(['chrome-mcp', 'cypress']),
  unitTesting: z.enum(['vitest']).default('vitest'),
  styling: z.enum(['tailwind', 'css-modules', 'styled-components']),
});

export type TechStack = z.infer<typeof TechStackSchema>;

export const DEFAULT_TECH_STACK: TechStack = {
  frontend: 'nextjs',
  backend: 'express',
  database: 'postgresql',
  testing: 'chrome-mcp',
  unitTesting: 'vitest',
  styling: 'tailwind',
};

// ============================================================================
// Session Types
// ============================================================================

export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed';

export type PipelinePhase =
  | 'init'
  | 'planning'
  | 'architecting'
  | 'coding'
  | 'reviewing'
  | 'testing'
  | 'completed'
  | 'failed';

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  techStack: TechStack;
  currentPhase: PipelinePhase;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Requirement Types
// ============================================================================

export type RequirementStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  testable: boolean;
  verified: boolean;
}

export interface StructuredSpec {
  title: string;
  description: string;
  userStories: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  technicalNotes: string[];
  dependencies: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface Requirement {
  id: string;
  sessionId: string;
  rawInput: string;
  structuredSpec: StructuredSpec | null;
  status: RequirementStatus;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Task Types
// ============================================================================

export type AgentType = 'planner' | 'architect' | 'designer' | 'coder' | 'reviewer' | 'tester' | 'decomposer';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';

export interface Task {
  id: string;
  sessionId: string;
  requirementId: string | null;
  agentType: AgentType;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: TaskStatus;
  retryCount: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

// ============================================================================
// Artifact Types
// ============================================================================

export type ArtifactType = 'spec' | 'architecture' | 'code' | 'review' | 'test';

export interface Artifact {
  id: string;
  taskId: string;
  sessionId: string;
  filePath: string;
  artifactType: ArtifactType;
  contentHash: string;
  createdAt: Date;
}

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface Checkpoint {
  id: string;
  sessionId: string;
  phase: PipelinePhase;
  taskId: string | null;
  state: {
    completedTasks: string[];
    pendingTasks: string[];
    artifacts: string[];
    context: Record<string, unknown>;
  };
  createdAt: Date;
}

// ============================================================================
// Agent Handoff Types
// ============================================================================

export interface AgentHandoff {
  fromAgent: AgentType;
  toAgent: AgentType;
  artifactType: ArtifactType;
  artifactId: string;
  summary: string;
  actionRequired: string[];
}

// ============================================================================
// Pipeline Configuration
// ============================================================================

export const LOOP_LIMITS = {
  reviewToCoder: 3,
  testToCoder: 5,
  totalAgentCallsPerRequirement: 10,
} as const;

export const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
} as const;

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
  type: AgentType;
  model: 'opus' | 'sonnet' | 'haiku';
  tools: string[];
  systemPromptPath: string;
  outputSchemaPath: string;
  /** Optional list of MCP servers this agent should have access to */
  mcpServers?: string[];
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  decomposer: {
    type: 'decomposer',
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob'],
    systemPromptPath: 'prompts/decomposer.md',
    outputSchemaPath: 'schemas/decomposer-output.json',
  },
  planner: {
    type: 'planner',
    model: 'opus',
    tools: ['Read', 'Grep', 'Glob'],
    systemPromptPath: 'prompts/planner.md',
    outputSchemaPath: 'schemas/planner-output.json',
  },
  architect: {
    type: 'architect',
    model: 'opus',
    tools: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    systemPromptPath: 'prompts/architect.md',
    outputSchemaPath: 'schemas/architect-output.json',
  },
  designer: {
    type: 'designer',
    model: 'opus',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    systemPromptPath: 'prompts/designer.md',
    outputSchemaPath: 'schemas/designer-output.json',
  },
  coder: {
    type: 'coder',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    systemPromptPath: 'prompts/coder.md',
    outputSchemaPath: 'schemas/coder-output.json',
  },
  reviewer: {
    type: 'reviewer',
    model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    systemPromptPath: 'prompts/reviewer.md',
    outputSchemaPath: 'schemas/reviewer-output.json',
  },
  tester: {
    type: 'tester',
    model: 'sonnet',
    tools: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    systemPromptPath: 'prompts/tester.md',
    outputSchemaPath: 'schemas/tester-output.json',
  },
};

// ============================================================================
// Worktree Types (for concurrent execution)
// ============================================================================

export type WorktreeStatus = 'active' | 'merged' | 'abandoned';

export interface Worktree {
  id: string;
  sessionId: string;
  requirementId: string | null;
  branchName: string;
  worktreePath: string;
  status: WorktreeStatus;
  createdAt: Date;
  mergedAt: Date | null;
}

// ============================================================================
// Job Types (for tracking running jobs)
// ============================================================================

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  sessionId: string;
  requirementId: string;
  worktreeId: string | null;
  phase: PipelinePhase;
  status: JobStatus;
  pid: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

// ============================================================================
// Planning Types (for autonomous project decomposition)
// ============================================================================

export type PlanStatus = 'drafting' | 'questioning' | 'pending_approval' | 'approved' | 'executing' | 'completed' | 'rejected';

export type QuestionCategory = 'scope' | 'technical' | 'ux' | 'integration' | 'priority' | 'constraints';

export interface ClarifyingQuestion {
  id: string;
  category: QuestionCategory;
  question: string;
  context: string;
  suggestedOptions?: string[];
  answer?: string;
  answeredAt?: Date;
}

export interface PlannedRequirement {
  id: string;
  title: string;
  description: string;
  userStories: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  technicalNotes: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  dependencies: string[];
  priority: number;
  rationale: string;
}

export interface ArchitecturalDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  alternatives: string[];
  tradeoffs: string;
}

export interface Risk {
  id: string;
  description: string;
  likelihood: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface Plan {
  id: string;
  sessionId: string;
  highLevelGoal: string;
  status: PlanStatus;
  questions: ClarifyingQuestion[];
  requirements: PlannedRequirement[];
  architecturalDecisions: ArchitecturalDecision[];
  implementationOrder: string[];
  overview: string;
  assumptions: string[];
  outOfScope: string[];
  risks: Risk[];
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
}

// ============================================================================
// Cloud Service Link Types (for GitHub, Supabase, Vercel integration)
// ============================================================================

export type CloudService = 'github' | 'supabase' | 'vercel';

export type CloudEnvironment = 'staging' | 'production' | 'both';

export interface CloudServiceLink {
  id: string;
  sessionId: string;
  service: CloudService;
  projectId: string;
  projectName: string;
  projectUrl: string;
  environment: CloudEnvironment;
  linkedAt: Date;
  metadata: Record<string, string>;
}
