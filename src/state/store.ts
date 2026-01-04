import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  Session,
  SessionStatus,
  PipelinePhase,
  TechStack,
  Requirement,
  RequirementStatus,
  StructuredSpec,
  Task,
  TaskStatus,
  AgentType,
  Artifact,
  ArtifactType,
  Checkpoint,
  Worktree,
  WorktreeStatus,
  Job,
  JobStatus,
  Plan,
  PlanStatus,
  ClarifyingQuestion,
  PlannedRequirement,
  ArchitecturalDecision,
  Risk,
  CloudServiceLink,
  CloudService,
  CloudEnvironment,
} from '../core/types.js';

// ============================================================================
// State Store Interface
// ============================================================================

export interface StateStore {
  // Session operations
  createSession(params: CreateSessionParams): Session;
  getSession(id: string): Session | null;
  getSessionByPath(projectPath: string): Session | null;
  updateSession(id: string, updates: Partial<UpdateSessionParams>): Session;
  listSessions(): Session[];

  // Requirement operations
  createRequirement(params: CreateRequirementParams): Requirement;
  getRequirement(id: string): Requirement | null;
  getRequirementsBySession(sessionId: string): Requirement[];
  updateRequirement(id: string, updates: Partial<UpdateRequirementParams>): Requirement;

  // Task operations
  createTask(params: CreateTaskParams): Task;
  getTask(id: string): Task | null;
  getTasksBySession(sessionId: string): Task[];
  getTasksByRequirement(requirementId: string): Task[];
  getPendingTasks(sessionId: string): Task[];
  updateTask(id: string, updates: Partial<UpdateTaskParams>): Task;

  // Artifact operations
  createArtifact(params: CreateArtifactParams): Artifact;
  getArtifact(id: string): Artifact | null;
  getArtifactsBySession(sessionId: string): Artifact[];
  getArtifactsByTask(taskId: string): Artifact[];

  // Checkpoint operations
  createCheckpoint(params: CreateCheckpointParams): Checkpoint;
  getLatestCheckpoint(sessionId: string): Checkpoint | null;
  getCheckpoint(id: string): Checkpoint | null;

  // Worktree operations
  createWorktree(params: CreateWorktreeParams): Worktree;
  getWorktree(id: string): Worktree | null;
  getWorktreesBySession(sessionId: string): Worktree[];
  getActiveWorktrees(sessionId: string): Worktree[];
  updateWorktree(id: string, updates: Partial<UpdateWorktreeParams>): Worktree;

  // Job operations
  createJob(params: CreateJobParams): Job;
  getJob(id: string): Job | null;
  getJobsBySession(sessionId: string): Job[];
  getRunningJobs(sessionId: string): Job[];
  getJobByRequirement(requirementId: string): Job | null;
  updateJob(id: string, updates: Partial<UpdateJobParams>): Job;

  // Plan operations
  createPlan(params: CreatePlanParams): Plan;
  getPlan(id: string): Plan | null;
  getPlansBySession(sessionId: string): Plan[];
  getActivePlan(sessionId: string): Plan | null;
  updatePlan(id: string, updates: Partial<UpdatePlanParams>): Plan;

  // Cloud service link operations
  createCloudServiceLink(params: CreateCloudServiceLinkParams): CloudServiceLink;
  getCloudServiceLinks(sessionId: string): CloudServiceLink[];
  getCloudServiceLink(sessionId: string, service: CloudService): CloudServiceLink | null;
  deleteCloudServiceLink(id: string): void;

  // Utility
  close(): void;
}

// ============================================================================
// Parameter Types
// ============================================================================

interface CreateSessionParams {
  projectPath: string;
  projectName: string;
  techStack: TechStack;
}

interface UpdateSessionParams {
  currentPhase: PipelinePhase;
  status: SessionStatus;
}

interface CreateRequirementParams {
  sessionId: string;
  rawInput: string;
  priority?: number;
}

interface UpdateRequirementParams {
  structuredSpec: StructuredSpec;
  status: RequirementStatus;
  priority: number;
}

interface CreateTaskParams {
  sessionId: string;
  requirementId: string | null;
  agentType: AgentType;
  input: Record<string, unknown>;
}

interface UpdateTaskParams {
  status: TaskStatus;
  output: Record<string, unknown>;
  errorMessage: string;
  retryCount: number;
  startedAt: Date;
  completedAt: Date;
}

interface CreateArtifactParams {
  taskId: string;
  sessionId: string;
  filePath: string;
  artifactType: ArtifactType;
  contentHash: string;
}

interface CreateCheckpointParams {
  sessionId: string;
  phase: PipelinePhase;
  taskId: string | null;
  state: Checkpoint['state'];
}

interface CreateWorktreeParams {
  sessionId: string;
  requirementId: string | null;
  branchName: string;
  worktreePath: string;
}

interface UpdateWorktreeParams {
  status: WorktreeStatus;
  mergedAt: Date;
}

interface CreateJobParams {
  sessionId: string;
  requirementId: string;
  worktreeId: string | null;
  phase?: PipelinePhase;
}

interface UpdateJobParams {
  phase: PipelinePhase;
  status: JobStatus;
  pid: number;
  startedAt: Date;
  completedAt: Date;
  errorMessage: string;
}

interface CreatePlanParams {
  sessionId: string;
  highLevelGoal: string;
}

interface UpdatePlanParams {
  status: PlanStatus;
  questions: ClarifyingQuestion[];
  requirements: PlannedRequirement[];
  architecturalDecisions: ArchitecturalDecision[];
  implementationOrder: string[];
  overview: string;
  assumptions: string[];
  outOfScope: string[];
  risks: Risk[];
  approvedAt: Date;
}

interface CreateCloudServiceLinkParams {
  sessionId: string;
  service: CloudService;
  projectId: string;
  projectName: string;
  projectUrl: string;
  environment: CloudEnvironment;
  metadata?: Record<string, string>;
}

// ============================================================================
// SQLite Implementation
// ============================================================================

export class SQLiteStore implements StateStore {
  private db: Database.Database;
  private closed = false;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();

    // Ensure database is closed on process exit to avoid WAL file issues
    const cleanup = () => {
      if (!this.closed) {
        this.close();
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  private migrate(): void {
    this.db.exec(`
      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL UNIQUE,
        project_name TEXT NOT NULL,
        tech_stack TEXT NOT NULL,
        current_phase TEXT NOT NULL DEFAULT 'init',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Requirements table
      CREATE TABLE IF NOT EXISTS requirements (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        raw_input TEXT NOT NULL,
        structured_spec TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Tasks table
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
        agent_type TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );

      -- Artifacts table
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Checkpoints table
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Worktrees table
      CREATE TABLE IF NOT EXISTS worktrees (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
        branch_name TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        merged_at TEXT
      );

      -- Jobs table
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
        worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL,
        phase TEXT NOT NULL DEFAULT 'init',
        status TEXT NOT NULL DEFAULT 'queued',
        pid INTEGER,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      -- Plans table
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        high_level_goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'drafting',
        questions TEXT,
        requirements TEXT,
        architectural_decisions TEXT,
        implementation_order TEXT,
        overview TEXT,
        assumptions TEXT,
        out_of_scope TEXT,
        risks TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT
      );

      -- Cloud service links table
      CREATE TABLE IF NOT EXISTS cloud_service_links (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        service TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        project_url TEXT NOT NULL,
        environment TEXT NOT NULL,
        metadata TEXT,
        linked_at TEXT NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_requirements_session ON requirements(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_requirement ON tasks(requirement_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
      CREATE INDEX IF NOT EXISTS idx_worktrees_session ON worktrees(session_id);
      CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_requirement ON jobs(requirement_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
      CREATE INDEX IF NOT EXISTS idx_cloud_links_session ON cloud_service_links(session_id);
      CREATE INDEX IF NOT EXISTS idx_cloud_links_service ON cloud_service_links(service);
    `);
  }

  // --------------------------------------------------------------------------
  // Session Operations
  // --------------------------------------------------------------------------

  createSession(params: CreateSessionParams): Session {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, project_path, project_name, tech_stack, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.projectPath, params.projectName, JSON.stringify(params.techStack), now, now);

    const session = this.getSession(id);
    if (!session) throw new Error('Failed to create session');
    return session;
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  getSessionByPath(projectPath: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE project_path = ?').get(projectPath) as SessionRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  updateSession(id: string, updates: Partial<UpdateSessionParams>): Session {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (updates.currentPhase !== undefined) {
      sets.push('current_phase = ?');
      values.push(updates.currentPhase);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }

    values.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    return session;
  }

  listSessions(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[];
    return rows.map((row: SessionRow) => this.mapSession(row));
  }

  // --------------------------------------------------------------------------
  // Requirement Operations
  // --------------------------------------------------------------------------

  createRequirement(params: CreateRequirementParams): Requirement {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO requirements (id, session_id, raw_input, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.sessionId, params.rawInput, params.priority ?? 0, now, now);

    const requirement = this.getRequirement(id);
    if (!requirement) throw new Error('Failed to create requirement');
    return requirement;
  }

  getRequirement(id: string): Requirement | null {
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow | undefined;
    return row ? this.mapRequirement(row) : null;
  }

  getRequirementsBySession(sessionId: string): Requirement[] {
    const rows = this.db.prepare(
      'SELECT * FROM requirements WHERE session_id = ? ORDER BY priority DESC, created_at ASC'
    ).all(sessionId) as RequirementRow[];
    return rows.map((row: RequirementRow) => this.mapRequirement(row));
  }

  updateRequirement(id: string, updates: Partial<UpdateRequirementParams>): Requirement {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (updates.structuredSpec !== undefined) {
      sets.push('structured_spec = ?');
      values.push(JSON.stringify(updates.structuredSpec));
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.priority !== undefined) {
      sets.push('priority = ?');
      values.push(updates.priority);
    }

    values.push(id);
    this.db.prepare(`UPDATE requirements SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    const requirement = this.getRequirement(id);
    if (!requirement) throw new Error('Requirement not found');
    return requirement;
  }

  // --------------------------------------------------------------------------
  // Task Operations
  // --------------------------------------------------------------------------

  createTask(params: CreateTaskParams): Task {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO tasks (id, session_id, requirement_id, agent_type, input, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.sessionId, params.requirementId, params.agentType, JSON.stringify(params.input), now);

    const task = this.getTask(id);
    if (!task) throw new Error('Failed to create task');
    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  getTasksBySession(sessionId: string): Task[] {
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId) as TaskRow[];
    return rows.map((row: TaskRow) => this.mapTask(row));
  }

  getTasksByRequirement(requirementId: string): Task[] {
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE requirement_id = ? ORDER BY created_at ASC'
    ).all(requirementId) as TaskRow[];
    return rows.map((row: TaskRow) => this.mapTask(row));
  }

  getPendingTasks(sessionId: string): Task[] {
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE session_id = ? AND status = ? ORDER BY created_at ASC'
    ).all(sessionId, 'pending') as TaskRow[];
    return rows.map((row: TaskRow) => this.mapTask(row));
  }

  updateTask(id: string, updates: Partial<UpdateTaskParams>): Task {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.output !== undefined) {
      sets.push('output = ?');
      values.push(JSON.stringify(updates.output));
    }
    if (updates.errorMessage !== undefined) {
      sets.push('error_message = ?');
      values.push(updates.errorMessage);
    }
    if (updates.retryCount !== undefined) {
      sets.push('retry_count = ?');
      values.push(updates.retryCount);
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      values.push(updates.startedAt.toISOString());
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      values.push(updates.completedAt.toISOString());
    }

    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    const task = this.getTask(id);
    if (!task) throw new Error('Task not found');
    return task;
  }

  // --------------------------------------------------------------------------
  // Artifact Operations
  // --------------------------------------------------------------------------

  createArtifact(params: CreateArtifactParams): Artifact {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO artifacts (id, task_id, session_id, file_path, artifact_type, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.taskId, params.sessionId, params.filePath, params.artifactType, params.contentHash, now);

    const artifact = this.getArtifact(id);
    if (!artifact) throw new Error('Failed to create artifact');
    return artifact;
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow | undefined;
    return row ? this.mapArtifact(row) : null;
  }

  getArtifactsBySession(sessionId: string): Artifact[] {
    const rows = this.db.prepare(
      'SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId) as ArtifactRow[];
    return rows.map((row: ArtifactRow) => this.mapArtifact(row));
  }

  getArtifactsByTask(taskId: string): Artifact[] {
    const rows = this.db.prepare(
      'SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC'
    ).all(taskId) as ArtifactRow[];
    return rows.map((row: ArtifactRow) => this.mapArtifact(row));
  }

  // --------------------------------------------------------------------------
  // Checkpoint Operations
  // --------------------------------------------------------------------------

  createCheckpoint(params: CreateCheckpointParams): Checkpoint {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO checkpoints (id, session_id, phase, task_id, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.sessionId, params.phase, params.taskId, JSON.stringify(params.state), now);

    const checkpoint = this.getCheckpoint(id);
    if (!checkpoint) throw new Error('Failed to create checkpoint');
    return checkpoint;
  }

  getLatestCheckpoint(sessionId: string): Checkpoint | null {
    const row = this.db.prepare(
      'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(sessionId) as CheckpointRow | undefined;
    return row ? this.mapCheckpoint(row) : null;
  }

  getCheckpoint(id: string): Checkpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as CheckpointRow | undefined;
    return row ? this.mapCheckpoint(row) : null;
  }

  // --------------------------------------------------------------------------
  // Worktree Operations
  // --------------------------------------------------------------------------

  createWorktree(params: CreateWorktreeParams): Worktree {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO worktrees (id, session_id, requirement_id, branch_name, worktree_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.sessionId, params.requirementId, params.branchName, params.worktreePath, now);

    const worktree = this.getWorktree(id);
    if (!worktree) throw new Error('Failed to create worktree');
    return worktree;
  }

  getWorktree(id: string): Worktree | null {
    const row = this.db.prepare('SELECT * FROM worktrees WHERE id = ?').get(id) as WorktreeRow | undefined;
    return row ? this.mapWorktree(row) : null;
  }

  getWorktreesBySession(sessionId: string): Worktree[] {
    const rows = this.db.prepare(
      'SELECT * FROM worktrees WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as WorktreeRow[];
    return rows.map((row: WorktreeRow) => this.mapWorktree(row));
  }

  getActiveWorktrees(sessionId: string): Worktree[] {
    const rows = this.db.prepare(
      'SELECT * FROM worktrees WHERE session_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(sessionId, 'active') as WorktreeRow[];
    return rows.map((row: WorktreeRow) => this.mapWorktree(row));
  }

  updateWorktree(id: string, updates: Partial<UpdateWorktreeParams>): Worktree {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.mergedAt !== undefined) {
      sets.push('merged_at = ?');
      values.push(updates.mergedAt.toISOString());
    }

    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE worktrees SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    const worktree = this.getWorktree(id);
    if (!worktree) throw new Error('Worktree not found');
    return worktree;
  }

  // --------------------------------------------------------------------------
  // Job Operations
  // --------------------------------------------------------------------------

  createJob(params: CreateJobParams): Job {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO jobs (id, session_id, requirement_id, worktree_id, phase, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.sessionId, params.requirementId, params.worktreeId, params.phase ?? 'init', now);

    const job = this.getJob(id);
    if (!job) throw new Error('Failed to create job');
    return job;
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? this.mapJob(row) : null;
  }

  getJobsBySession(sessionId: string): Job[] {
    const rows = this.db.prepare(
      'SELECT * FROM jobs WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as JobRow[];
    return rows.map((row: JobRow) => this.mapJob(row));
  }

  getRunningJobs(sessionId: string): Job[] {
    const rows = this.db.prepare(
      'SELECT * FROM jobs WHERE session_id = ? AND status = ? ORDER BY created_at ASC'
    ).all(sessionId, 'running') as JobRow[];
    return rows.map((row: JobRow) => this.mapJob(row));
  }

  getJobByRequirement(requirementId: string): Job | null {
    const row = this.db.prepare(
      'SELECT * FROM jobs WHERE requirement_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(requirementId) as JobRow | undefined;
    return row ? this.mapJob(row) : null;
  }

  updateJob(id: string, updates: Partial<UpdateJobParams>): Job {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.phase !== undefined) {
      sets.push('phase = ?');
      values.push(updates.phase);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.pid !== undefined) {
      sets.push('pid = ?');
      values.push(updates.pid);
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      values.push(updates.startedAt.toISOString());
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      values.push(updates.completedAt.toISOString());
    }
    if (updates.errorMessage !== undefined) {
      sets.push('error_message = ?');
      values.push(updates.errorMessage);
    }

    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    const job = this.getJob(id);
    if (!job) throw new Error('Job not found');
    return job;
  }

  // --------------------------------------------------------------------------
  // Plan Operations
  // --------------------------------------------------------------------------

  createPlan(params: CreatePlanParams): Plan {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO plans (id, session_id, high_level_goal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, params.sessionId, params.highLevelGoal, now, now);

    const plan = this.getPlan(id);
    if (!plan) throw new Error('Failed to create plan');
    return plan;
  }

  getPlan(id: string): Plan | null {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
    return row ? this.mapPlan(row) : null;
  }

  getPlansBySession(sessionId: string): Plan[] {
    const rows = this.db.prepare(
      'SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as PlanRow[];
    return rows.map((row: PlanRow) => this.mapPlan(row));
  }

  getActivePlan(sessionId: string): Plan | null {
    // Get the most recent plan that is not completed or rejected
    const row = this.db.prepare(`
      SELECT * FROM plans
      WHERE session_id = ?
        AND status NOT IN ('completed', 'rejected')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId) as PlanRow | undefined;
    return row ? this.mapPlan(row) : null;
  }

  updatePlan(id: string, updates: Partial<UpdatePlanParams>): Plan {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.questions !== undefined) {
      sets.push('questions = ?');
      values.push(JSON.stringify(updates.questions));
    }
    if (updates.requirements !== undefined) {
      sets.push('requirements = ?');
      values.push(JSON.stringify(updates.requirements));
    }
    if (updates.architecturalDecisions !== undefined) {
      sets.push('architectural_decisions = ?');
      values.push(JSON.stringify(updates.architecturalDecisions));
    }
    if (updates.implementationOrder !== undefined) {
      sets.push('implementation_order = ?');
      values.push(JSON.stringify(updates.implementationOrder));
    }
    if (updates.overview !== undefined) {
      sets.push('overview = ?');
      values.push(updates.overview);
    }
    if (updates.assumptions !== undefined) {
      sets.push('assumptions = ?');
      values.push(JSON.stringify(updates.assumptions));
    }
    if (updates.outOfScope !== undefined) {
      sets.push('out_of_scope = ?');
      values.push(JSON.stringify(updates.outOfScope));
    }
    if (updates.risks !== undefined) {
      sets.push('risks = ?');
      values.push(JSON.stringify(updates.risks));
    }
    if (updates.approvedAt !== undefined) {
      sets.push('approved_at = ?');
      values.push(updates.approvedAt.toISOString());
    }

    values.push(id);
    this.db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    const plan = this.getPlan(id);
    if (!plan) throw new Error('Plan not found');
    return plan;
  }

  // --------------------------------------------------------------------------
  // Cloud Service Link Operations
  // --------------------------------------------------------------------------

  createCloudServiceLink(params: CreateCloudServiceLinkParams): CloudServiceLink {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO cloud_service_links (id, session_id, service, project_id, project_name, project_url, environment, metadata, linked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.sessionId,
      params.service,
      params.projectId,
      params.projectName,
      params.projectUrl,
      params.environment,
      JSON.stringify(params.metadata ?? {}),
      now
    );

    const link = this.getCloudServiceLinkById(id);
    if (!link) throw new Error('Failed to create cloud service link');
    return link;
  }

  private getCloudServiceLinkById(id: string): CloudServiceLink | null {
    const row = this.db.prepare('SELECT * FROM cloud_service_links WHERE id = ?').get(id) as CloudServiceLinkRow | undefined;
    return row ? this.mapCloudServiceLink(row) : null;
  }

  getCloudServiceLinks(sessionId: string): CloudServiceLink[] {
    const rows = this.db.prepare(
      'SELECT * FROM cloud_service_links WHERE session_id = ? ORDER BY linked_at DESC'
    ).all(sessionId) as CloudServiceLinkRow[];
    return rows.map((row: CloudServiceLinkRow) => this.mapCloudServiceLink(row));
  }

  getCloudServiceLink(sessionId: string, service: CloudService): CloudServiceLink | null {
    const row = this.db.prepare(
      'SELECT * FROM cloud_service_links WHERE session_id = ? AND service = ? ORDER BY linked_at DESC LIMIT 1'
    ).get(sessionId, service) as CloudServiceLinkRow | undefined;
    return row ? this.mapCloudServiceLink(row) : null;
  }

  deleteCloudServiceLink(id: string): void {
    this.db.prepare('DELETE FROM cloud_service_links WHERE id = ?').run(id);
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  // --------------------------------------------------------------------------
  // Mappers
  // --------------------------------------------------------------------------

  private mapSession(row: SessionRow): Session {
    return {
      id: row.id,
      projectPath: row.project_path,
      projectName: row.project_name,
      techStack: JSON.parse(row.tech_stack) as TechStack,
      currentPhase: row.current_phase as PipelinePhase,
      status: row.status as SessionStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapRequirement(row: RequirementRow): Requirement {
    return {
      id: row.id,
      sessionId: row.session_id,
      rawInput: row.raw_input,
      structuredSpec: row.structured_spec ? JSON.parse(row.structured_spec) as StructuredSpec : null,
      status: row.status as RequirementStatus,
      priority: row.priority,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapTask(row: TaskRow): Task {
    return {
      id: row.id,
      sessionId: row.session_id,
      requirementId: row.requirement_id,
      agentType: row.agent_type as AgentType,
      input: JSON.parse(row.input) as Record<string, unknown>,
      output: row.output ? JSON.parse(row.output) as Record<string, unknown> : null,
      status: row.status as TaskStatus,
      retryCount: row.retry_count,
      errorMessage: row.error_message,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
    };
  }

  private mapArtifact(row: ArtifactRow): Artifact {
    return {
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      filePath: row.file_path,
      artifactType: row.artifact_type as ArtifactType,
      contentHash: row.content_hash,
      createdAt: new Date(row.created_at),
    };
  }

  private mapCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      id: row.id,
      sessionId: row.session_id,
      phase: row.phase as PipelinePhase,
      taskId: row.task_id,
      state: JSON.parse(row.state) as Checkpoint['state'],
      createdAt: new Date(row.created_at),
    };
  }

  private mapWorktree(row: WorktreeRow): Worktree {
    return {
      id: row.id,
      sessionId: row.session_id,
      requirementId: row.requirement_id,
      branchName: row.branch_name,
      worktreePath: row.worktree_path,
      status: row.status as WorktreeStatus,
      createdAt: new Date(row.created_at),
      mergedAt: row.merged_at ? new Date(row.merged_at) : null,
    };
  }

  private mapJob(row: JobRow): Job {
    return {
      id: row.id,
      sessionId: row.session_id,
      requirementId: row.requirement_id,
      worktreeId: row.worktree_id,
      phase: row.phase as PipelinePhase,
      status: row.status as JobStatus,
      pid: row.pid,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
    };
  }

  private mapPlan(row: PlanRow): Plan {
    const plan: Plan = {
      id: row.id,
      sessionId: row.session_id,
      highLevelGoal: row.high_level_goal,
      status: row.status as PlanStatus,
      questions: row.questions ? JSON.parse(row.questions) as ClarifyingQuestion[] : [],
      requirements: row.requirements ? JSON.parse(row.requirements) as PlannedRequirement[] : [],
      architecturalDecisions: row.architectural_decisions ? JSON.parse(row.architectural_decisions) as ArchitecturalDecision[] : [],
      implementationOrder: row.implementation_order ? JSON.parse(row.implementation_order) as string[] : [],
      overview: row.overview ?? '',
      assumptions: row.assumptions ? JSON.parse(row.assumptions) as string[] : [],
      outOfScope: row.out_of_scope ? JSON.parse(row.out_of_scope) as string[] : [],
      risks: row.risks ? JSON.parse(row.risks) as Risk[] : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };

    if (row.approved_at) {
      plan.approvedAt = new Date(row.approved_at);
    }

    return plan;
  }

  private mapCloudServiceLink(row: CloudServiceLinkRow): CloudServiceLink {
    return {
      id: row.id,
      sessionId: row.session_id,
      service: row.service as CloudService,
      projectId: row.project_id,
      projectName: row.project_name,
      projectUrl: row.project_url,
      environment: row.environment as CloudEnvironment,
      linkedAt: new Date(row.linked_at),
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, string> : {},
    };
  }
}

// ============================================================================
// Row Types (SQLite)
// ============================================================================

interface SessionRow {
  id: string;
  project_path: string;
  project_name: string;
  tech_stack: string;
  current_phase: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RequirementRow {
  id: string;
  session_id: string;
  raw_input: string;
  structured_spec: string | null;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  session_id: string;
  requirement_id: string | null;
  agent_type: string;
  input: string;
  output: string | null;
  status: string;
  retry_count: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ArtifactRow {
  id: string;
  task_id: string;
  session_id: string;
  file_path: string;
  artifact_type: string;
  content_hash: string;
  created_at: string;
}

interface CheckpointRow {
  id: string;
  session_id: string;
  phase: string;
  task_id: string | null;
  state: string;
  created_at: string;
}

interface WorktreeRow {
  id: string;
  session_id: string;
  requirement_id: string | null;
  branch_name: string;
  worktree_path: string;
  status: string;
  created_at: string;
  merged_at: string | null;
}

interface JobRow {
  id: string;
  session_id: string;
  requirement_id: string;
  worktree_id: string | null;
  phase: string;
  status: string;
  pid: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface PlanRow {
  id: string;
  session_id: string;
  high_level_goal: string;
  status: string;
  questions: string | null;
  requirements: string | null;
  architectural_decisions: string | null;
  implementation_order: string | null;
  overview: string | null;
  assumptions: string | null;
  out_of_scope: string | null;
  risks: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

interface CloudServiceLinkRow {
  id: string;
  session_id: string;
  service: string;
  project_id: string;
  project_name: string;
  project_url: string;
  environment: string;
  metadata: string | null;
  linked_at: string;
}

// ============================================================================
// Factory Function
// ============================================================================

export function createStore(projectPath: string): StateStore {
  const dbPath = `${projectPath}/.orchestrator/orchestrator.db`;
  return new SQLiteStore(dbPath);
}
