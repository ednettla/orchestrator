import { STUCK_DETECTION_CONFIG } from './monitor.js';

// ============================================================================
// Types
// ============================================================================

export interface JobState {
  jobId: string;
  lastAnyOutput: Date;
  lastSubstantiveOutput: Date;
  isInThinkingBlock: boolean;
  currentToolStart: Date | null;
  warningIssued: boolean;
}

export interface StuckStatus {
  stuck: boolean;
  warning: boolean;
  reason?: 'idle_timeout' | 'thinking_timeout' | 'tool_timeout';
  secondsSinceActivity: number;
  secondsUntilTimeout: number;
}

// ============================================================================
// Stuck Detector
// ============================================================================

export class StuckDetector {
  private states: Map<string, JobState> = new Map();
  private config = STUCK_DETECTION_CONFIG;

  /**
   * Initialize tracking for a new job
   */
  startTracking(jobId: string): void {
    const now = new Date();
    this.states.set(jobId, {
      jobId,
      lastAnyOutput: now,
      lastSubstantiveOutput: now,
      isInThinkingBlock: false,
      currentToolStart: null,
      warningIssued: false,
    });
  }

  /**
   * Stop tracking a job
   */
  stopTracking(jobId: string): void {
    this.states.delete(jobId);
  }

  /**
   * Update state based on message content type
   */
  updateFromContentType(
    jobId: string,
    contentType: 'thinking' | 'text' | 'tool_use' | 'tool_result'
  ): void {
    const state = this.states.get(jobId);
    if (!state) return;

    state.lastAnyOutput = new Date();

    switch (contentType) {
      case 'thinking':
        state.isInThinkingBlock = true;
        // Don't update lastSubstantiveOutput - thinking isn't "progress"
        break;

      case 'text':
        state.isInThinkingBlock = false;
        state.lastSubstantiveOutput = new Date();
        state.currentToolStart = null;
        break;

      case 'tool_use':
        state.isInThinkingBlock = false;
        state.currentToolStart = new Date();
        state.lastSubstantiveOutput = new Date();
        break;

      case 'tool_result':
        state.currentToolStart = null;
        state.lastSubstantiveOutput = new Date();
        break;
    }

    // Reset warning when we get new activity
    state.warningIssued = false;
  }

  /**
   * Record any output (even non-substantive)
   */
  recordOutput(jobId: string): void {
    const state = this.states.get(jobId);
    if (state) {
      state.lastAnyOutput = new Date();
    }
  }

  /**
   * Check if a job is stuck
   */
  checkJob(jobId: string): StuckStatus {
    const state = this.states.get(jobId);
    if (!state) {
      return {
        stuck: false,
        warning: false,
        secondsSinceActivity: 0,
        secondsUntilTimeout: Infinity,
      };
    }

    const now = Date.now();
    let timeoutMs: number;
    let elapsed: number;
    let reason: StuckStatus['reason'];

    if (state.isInThinkingBlock) {
      // In thinking mode - use longer timeout
      timeoutMs = this.config.thinkingTimeoutMs;
      elapsed = now - state.lastAnyOutput.getTime();
      reason = 'thinking_timeout';
    } else if (state.currentToolStart) {
      // Tool is executing - check tool-specific timeout
      timeoutMs = this.config.toolTimeoutMs;
      elapsed = now - state.currentToolStart.getTime();
      reason = 'tool_timeout';
    } else {
      // Normal idle check
      timeoutMs = this.config.idleTimeoutMs;
      elapsed = now - state.lastSubstantiveOutput.getTime();
      reason = 'idle_timeout';
    }

    const secondsSinceActivity = Math.floor(elapsed / 1000);
    const secondsUntilTimeout = Math.floor((timeoutMs - elapsed) / 1000);
    const warningThreshold = timeoutMs * this.config.warningThreshold;

    if (elapsed > timeoutMs) {
      return {
        stuck: true,
        warning: true,
        reason,
        secondsSinceActivity,
        secondsUntilTimeout: 0,
      };
    }

    if (elapsed > warningThreshold && !state.warningIssued) {
      state.warningIssued = true;
      return {
        stuck: false,
        warning: true,
        reason,
        secondsSinceActivity,
        secondsUntilTimeout,
      };
    }

    return {
      stuck: false,
      warning: false,
      secondsSinceActivity,
      secondsUntilTimeout,
    };
  }

  /**
   * Get the current state for a job
   */
  getState(jobId: string): JobState | undefined {
    return this.states.get(jobId);
  }

  /**
   * Reset warning flag for a job (e.g., after retry)
   */
  resetWarning(jobId: string): void {
    const state = this.states.get(jobId);
    if (state) {
      state.warningIssued = false;
      state.lastAnyOutput = new Date();
      state.lastSubstantiveOutput = new Date();
      state.isInThinkingBlock = false;
      state.currentToolStart = null;
    }
  }

  /**
   * Clear all states
   */
  clear(): void {
    this.states.clear();
  }
}

// Singleton instance
export const stuckDetector = new StuckDetector();
