import type { Task } from '../core/types.js';
import type {
  AgentInvoker,
  AgentResult,
  StreamingOptions,
  ClaudeStreamMessage,
} from './invoker.js';
import { StuckDetector, type StuckStatus } from './stuck-detector.js';
import { AgentMonitor, STUCK_DETECTION_CONFIG } from './monitor.js';

// ============================================================================
// Types
// ============================================================================

export interface RetryableInvokerOptions {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Stuck detection check interval in ms (default: 1000) */
  checkIntervalMs?: number;
  /** Agent monitor for reporting activity */
  monitor?: AgentMonitor;
}

export interface RetryResult extends AgentResult {
  /** Number of retry attempts made */
  retryCount: number;
  /** Whether the job was killed due to being stuck */
  wasKilled: boolean;
  /** Reason for last kill if applicable */
  killReason?: 'idle_timeout' | 'thinking_timeout' | 'tool_timeout' | undefined;
}

// ============================================================================
// Retryable Invoker
// ============================================================================

/**
 * Wraps AgentInvoker with automatic stuck detection and retry logic.
 *
 * Monitors streaming output to detect stuck processes:
 * - Idle timeout: No substantive output for 2 minutes
 * - Thinking timeout: In thinking block for 3 minutes
 * - Tool timeout: Single tool execution for 5 minutes
 *
 * When stuck is detected:
 * 1. Kills the stuck process
 * 2. Reports retry attempt to monitor
 * 3. Retries with fresh process (up to maxRetries)
 */
export class RetryableInvoker {
  private invoker: AgentInvoker;
  private stuckDetector: StuckDetector;
  private monitor?: AgentMonitor;
  private maxRetries: number;
  private checkIntervalMs: number;

  constructor(invoker: AgentInvoker, options: RetryableInvokerOptions = {}) {
    this.invoker = invoker;
    this.stuckDetector = new StuckDetector();
    if (options.monitor) {
      this.monitor = options.monitor;
    }
    this.maxRetries = options.maxRetries ?? STUCK_DETECTION_CONFIG.maxRetries;
    this.checkIntervalMs = options.checkIntervalMs ?? STUCK_DETECTION_CONFIG.checkIntervalMs;
  }

  /**
   * Invoke an agent task with automatic retry on stuck detection
   */
  async invoke(
    task: Task,
    jobId: string,
    streamingOptions?: StreamingOptions
  ): Promise<RetryResult> {
    let lastResult: AgentResult | null = null;
    let retryCount = 0;
    let wasKilled = false;
    let killReason: StuckStatus['reason'] | undefined;

    while (retryCount <= this.maxRetries) {
      try {
        // Start tracking this job
        this.stuckDetector.startTracking(jobId);

        // Create a wrapped onMessage handler that updates stuck detector
        const wrappedStreamingOptions = this.wrapStreamingOptions(
          jobId,
          streamingOptions
        );

        // Start stuck monitoring
        const stuckMonitor = this.startStuckMonitoring(jobId);

        // Race between invoke and stuck detection
        const result = await Promise.race([
          this.invoker.invoke(task, wrappedStreamingOptions, jobId),
          stuckMonitor.stuckPromise,
        ]);

        // Stop monitoring
        stuckMonitor.stop();
        this.stuckDetector.stopTracking(jobId);

        // If we got a stuck signal (null result), handle retry
        if (result === null) {
          const status = this.stuckDetector.checkJob(jobId);
          killReason = status.reason;
          wasKilled = true;

          // Kill the stuck process
          await this.invoker.kill(jobId);

          retryCount++;

          // Report retry to monitor
          if (this.monitor) {
            this.monitor.reportRetry(jobId, retryCount, this.maxRetries);
          }

          // Reset stuck detector for retry
          this.stuckDetector.resetWarning(jobId);

          if (retryCount > this.maxRetries) {
            // Max retries exceeded
            return {
              success: false,
              output: {
                error: `Job stuck after ${retryCount} retry attempts. Last reason: ${killReason}`,
              },
              messages: [],
              retryCount,
              wasKilled: true,
              killReason,
            };
          }

          // Continue to retry
          continue;
        }

        // Success - return result with retry info
        lastResult = result;
        return {
          ...result,
          retryCount,
          wasKilled,
          killReason,
        };
      } catch (error) {
        // Clean up on error
        this.stuckDetector.stopTracking(jobId);

        // If this was a kill-related error, we might want to retry
        if (retryCount < this.maxRetries) {
          retryCount++;
          if (this.monitor) {
            this.monitor.reportRetry(jobId, retryCount, this.maxRetries);
          }
          continue;
        }

        // Max retries exceeded or fatal error
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          output: { error: errorMessage },
          messages: [],
          retryCount,
          wasKilled,
          killReason,
        };
      }
    }

    // Should not reach here, but handle edge case
    return {
      success: false,
      output: { error: 'Max retries exceeded' },
      messages: lastResult?.messages ?? [],
      retryCount,
      wasKilled,
      killReason,
    };
  }

  /**
   * Wrap streaming options to intercept messages for stuck detection
   */
  private wrapStreamingOptions(
    jobId: string,
    options?: StreamingOptions
  ): StreamingOptions {
    const originalOnMessage = options?.onMessage;

    return {
      stream: options?.stream ?? true, // Enable streaming for stuck detection
      onMessage: (message: ClaudeStreamMessage) => {
        // Update stuck detector based on message content
        this.processMessageForStuckDetection(jobId, message);

        // Call original handler if provided
        if (originalOnMessage) {
          originalOnMessage(message);
        }
      },
    };
  }

  /**
   * Process a streaming message to update stuck detection state
   */
  private processMessageForStuckDetection(
    jobId: string,
    message: ClaudeStreamMessage
  ): void {
    // Record any output
    this.stuckDetector.recordOutput(jobId);

    if (message.type === 'assistant' && message.message?.content) {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          switch (block.type) {
            case 'thinking':
              this.stuckDetector.updateFromContentType(jobId, 'thinking');
              break;
            case 'text':
              this.stuckDetector.updateFromContentType(jobId, 'text');
              break;
            case 'tool_use':
              this.stuckDetector.updateFromContentType(jobId, 'tool_use');
              break;
            case 'tool_result':
              this.stuckDetector.updateFromContentType(jobId, 'tool_result');
              break;
          }
        }
      }
    }
  }

  /**
   * Start monitoring a job for stuck state
   * Returns a promise that resolves to null when stuck is detected
   */
  private startStuckMonitoring(jobId: string): {
    stuckPromise: Promise<null>;
    stop: () => void;
  } {
    let stopped = false;
    let checkInterval: NodeJS.Timeout | null = null;
    let resolveStuck: ((value: null) => void) | null = null;

    const stuckPromise = new Promise<null>((resolve) => {
      resolveStuck = resolve;

      checkInterval = setInterval(() => {
        if (stopped) return;

        const status = this.stuckDetector.checkJob(jobId);

        // Report warning to monitor
        if (status.warning && !status.stuck && this.monitor) {
          this.monitor.reportStuckWarning(jobId, status.secondsSinceActivity);
        }

        // If stuck, resolve the promise to trigger kill/retry
        if (status.stuck) {
          stopped = true;
          if (checkInterval) {
            clearInterval(checkInterval);
          }
          resolve(null);
        }
      }, this.checkIntervalMs);
    });

    const stop = () => {
      stopped = true;
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    };

    return { stuckPromise, stop };
  }

  /**
   * Kill a specific job
   */
  async kill(jobId: string): Promise<boolean> {
    this.stuckDetector.stopTracking(jobId);
    return this.invoker.kill(jobId);
  }

  /**
   * Kill all active jobs
   */
  async killAll(): Promise<void> {
    this.stuckDetector.clear();
    return this.invoker.killAll();
  }

  /**
   * Check if a job is running
   */
  isRunning(jobId: string): boolean {
    return this.invoker.isRunning(jobId);
  }

  /**
   * Get all active job IDs
   */
  getActiveJobs(): string[] {
    return this.invoker.getActiveJobs();
  }
}
