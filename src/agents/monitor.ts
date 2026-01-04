import { EventEmitter } from 'node:events';
import type { PipelinePhase, AgentType } from '../core/types.js';
import type { ClaudeStreamMessage, StreamMessageContent } from './invoker.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolCallInfo {
  name: string;
  args: string;
  startedAt: Date;
}

export interface AgentActivity {
  jobId: string;
  requirementId: string;
  requirementTitle: string;
  phase: PipelinePhase;
  agentType: AgentType;
  startedAt: Date;
  lastActivityAt: Date;
  currentToolCall: ToolCallInfo | null;
  thinkingPreview: string | null;
  retryCount: number;
  status: 'running' | 'stuck_warning' | 'retrying' | 'completed' | 'failed';
}

export interface ProgressInfo {
  completed: number;
  total: number;
  percentage: number;
}

export interface MonitorEvents {
  activity: [jobId: string, activity: AgentActivity];
  tool_call: [jobId: string, toolCall: ToolCallInfo];
  stuck_warning: [jobId: string, secondsSinceActivity: number];
  retry: [jobId: string, attempt: number, maxAttempts: number];
  phase_change: [jobId: string, phase: PipelinePhase];
  job_complete: [jobId: string, success: boolean];
}

// ============================================================================
// Stuck Detection Config
// ============================================================================

export const STUCK_DETECTION_CONFIG = {
  idleTimeoutMs: 120_000,        // 2 min no output
  thinkingTimeoutMs: 180_000,    // 3 min in thinking
  toolTimeoutMs: 300_000,        // 5 min for tools
  warningThreshold: 0.75,        // Warn at 75%
  maxRetries: 3,
  checkIntervalMs: 1000,
} as const;

// ============================================================================
// Agent Monitor
// ============================================================================

export class AgentMonitor extends EventEmitter {
  private activities: Map<string, AgentActivity> = new Map();
  private globalStartTime: Date = new Date();
  private phaseStartTimes: Map<string, Date> = new Map();
  private totalJobs: number = 0;
  private completedJobs: number = 0;

  constructor() {
    super();
  }

  // ===========================================================================
  // Activity Reporting (called by invoker/pipeline)
  // ===========================================================================

  /**
   * Start tracking a new job
   */
  startJob(
    jobId: string,
    requirementId: string,
    requirementTitle: string,
    phase: PipelinePhase,
    agentType: AgentType
  ): void {
    const activity: AgentActivity = {
      jobId,
      requirementId,
      requirementTitle,
      phase,
      agentType,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      currentToolCall: null,
      thinkingPreview: null,
      retryCount: 0,
      status: 'running',
    };

    this.activities.set(jobId, activity);
    this.totalJobs++;
    this.emit('activity', jobId, activity);
  }

  /**
   * Report streaming activity from Claude
   */
  reportActivity(jobId: string, message: ClaudeStreamMessage): void {
    const activity = this.activities.get(jobId);
    if (!activity) return;

    activity.lastActivityAt = new Date();

    if (message.type === 'assistant' && message.message?.content) {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content as StreamMessageContent[]) {
          this.processContentBlock(jobId, activity, block);
        }
      }
    }

    this.emit('activity', jobId, activity);
  }

  private processContentBlock(
    jobId: string,
    activity: AgentActivity,
    block: StreamMessageContent
  ): void {
    switch (block.type) {
      case 'thinking':
        // Store preview of thinking (first 100 chars)
        if (block.thinking) {
          const lines = block.thinking.split('\n').filter(l => l.trim());
          activity.thinkingPreview = lines[0]?.substring(0, 100) || null;
        }
        break;

      case 'text':
        // Clear thinking preview when we get actual text
        activity.thinkingPreview = null;
        break;

      case 'tool_use':
        const toolCall: ToolCallInfo = {
          name: block.name || 'unknown',
          args: this.formatToolArgs(block.name || '', block.input),
          startedAt: new Date(),
        };
        activity.currentToolCall = toolCall;
        activity.thinkingPreview = null;
        this.emit('tool_call', jobId, toolCall);
        break;

      case 'tool_result':
        activity.currentToolCall = null;
        break;
    }
  }

  private formatToolArgs(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return '';

    const inp = input as Record<string, unknown>;

    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return this.shortenPath(String(inp.file_path ?? ''));
      case 'Glob':
        return String(inp.pattern ?? '');
      case 'Grep':
        return `"${inp.pattern}" in ${this.shortenPath(String(inp.path ?? '.'))}`;
      case 'Bash':
        const cmd = String(inp.command ?? '');
        return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
      case 'Task':
        return String(inp.description ?? '');
      default:
        return '';
    }
  }

  private shortenPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 2) return path;
    return parts.slice(-2).join('/');
  }

  /**
   * Report phase change
   */
  reportPhaseChange(jobId: string, phase: PipelinePhase): void {
    const activity = this.activities.get(jobId);
    if (!activity) return;

    activity.phase = phase;
    activity.lastActivityAt = new Date();

    const phaseKey = `${jobId}:${phase}`;
    this.phaseStartTimes.set(phaseKey, new Date());

    this.emit('phase_change', jobId, phase);
    this.emit('activity', jobId, activity);
  }

  /**
   * Report stuck warning
   */
  reportStuckWarning(jobId: string, secondsSinceActivity: number): void {
    const activity = this.activities.get(jobId);
    if (!activity) return;

    activity.status = 'stuck_warning';
    this.emit('stuck_warning', jobId, secondsSinceActivity);
    this.emit('activity', jobId, activity);
  }

  /**
   * Report retry attempt
   */
  reportRetry(jobId: string, attempt: number, maxAttempts: number): void {
    const activity = this.activities.get(jobId);
    if (!activity) return;

    activity.retryCount = attempt;
    activity.status = 'retrying';
    activity.lastActivityAt = new Date();
    activity.currentToolCall = null;
    activity.thinkingPreview = null;

    this.emit('retry', jobId, attempt, maxAttempts);
    this.emit('activity', jobId, activity);
  }

  /**
   * Mark job as complete
   */
  completeJob(jobId: string, success: boolean): void {
    const activity = this.activities.get(jobId);
    if (!activity) return;

    activity.status = success ? 'completed' : 'failed';
    activity.currentToolCall = null;
    activity.thinkingPreview = null;
    this.completedJobs++;

    this.emit('job_complete', jobId, success);
    this.emit('activity', jobId, activity);

    // Remove from active tracking after a delay
    setTimeout(() => {
      this.activities.delete(jobId);
    }, 5000);
  }

  // ===========================================================================
  // Query Methods (called by dashboard)
  // ===========================================================================

  /**
   * Get all active activities
   */
  getActivities(): AgentActivity[] {
    return Array.from(this.activities.values());
  }

  /**
   * Get a specific activity
   */
  getActivity(jobId: string): AgentActivity | undefined {
    return this.activities.get(jobId);
  }

  /**
   * Get total elapsed time in seconds
   */
  getElapsedTime(): number {
    return Math.floor((Date.now() - this.globalStartTime.getTime()) / 1000);
  }

  /**
   * Get elapsed time for a specific phase
   */
  getPhaseElapsedTime(jobId: string, phase: PipelinePhase): number {
    const phaseKey = `${jobId}:${phase}`;
    const startTime = this.phaseStartTimes.get(phaseKey);
    if (!startTime) return 0;
    return Math.floor((Date.now() - startTime.getTime()) / 1000);
  }

  /**
   * Get overall progress
   */
  getOverallProgress(): ProgressInfo {
    const total = this.totalJobs || 1;
    const completed = this.completedJobs;
    return {
      completed,
      total,
      percentage: Math.round((completed / total) * 100),
    };
  }

  /**
   * Set total expected jobs (for progress calculation)
   */
  setTotalJobs(total: number): void {
    this.totalJobs = total;
  }

  /**
   * Reset the monitor for a new run
   */
  reset(): void {
    this.activities.clear();
    this.phaseStartTimes.clear();
    this.globalStartTime = new Date();
    this.totalJobs = 0;
    this.completedJobs = 0;
  }
}

// Singleton instance for sharing across modules
export const agentMonitor = new AgentMonitor();
