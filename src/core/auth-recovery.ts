/**
 * Auth Recovery
 *
 * Manages pipeline pause/resume for auth failures and handles
 * notifications to users via Telegram and CLI.
 *
 * @module auth-recovery
 */

import chalk from 'chalk';
import { getGlobalStore, type GlobalStore } from './global-store.js';
import { getAuthErrorHandler, type AuthErrorHandler } from './auth-error-handler.js';
import { getAuthSourceManager, type AuthSourceManager } from './auth-source-manager.js';
import type {
  AuthService,
  PausedPipeline,
  PausePipelineParams,
  PausedPipelineStatus,
  AuthFailureNotification,
  AuthRestoredNotification,
  AuthError,
} from './auth-types.js';

// ============================================================================
// Types
// ============================================================================

export interface NotificationService {
  sendAuthFailure(notification: AuthFailureNotification): Promise<void>;
  sendAuthRestored(notification: AuthRestoredNotification): Promise<void>;
}

// ============================================================================
// Auth Recovery
// ============================================================================

export class AuthRecovery {
  private globalStore: GlobalStore;
  private errorHandler: AuthErrorHandler;
  private authSourceManager: AuthSourceManager;
  private notificationService: NotificationService | null = null;

  constructor() {
    this.globalStore = getGlobalStore();
    this.errorHandler = getAuthErrorHandler();
    this.authSourceManager = getAuthSourceManager();
  }

  /**
   * Set the notification service for sending alerts
   */
  setNotificationService(service: NotificationService): void {
    this.notificationService = service;
  }

  /**
   * Pause a pipeline due to auth failure
   */
  async pausePipeline(params: PausePipelineParams): Promise<PausedPipeline> {
    // Create the paused pipeline record
    const pausedPipeline = this.globalStore.pausePipeline(params);

    // Get the error details
    const error = this.errorHandler.getError(params.errorId);

    // Log to CLI
    this.logPipelinePaused(pausedPipeline, error);

    // Send notification if service is configured
    if (this.notificationService && error) {
      const projectName = params.projectPath.split('/').pop() ?? params.projectPath;
      await this.notificationService.sendAuthFailure({
        service: params.service,
        projectPath: params.projectPath,
        projectName,
        errorType: error.errorType,
        errorMessage: error.errorMessage,
        pausedPhase: params.pausedPhase,
        timestamp: new Date(),
      });
    }

    return pausedPipeline;
  }

  /**
   * Get a paused pipeline by ID
   */
  getPausedPipeline(id: string): PausedPipeline | null {
    return this.globalStore.getPausedPipeline(id);
  }

  /**
   * Get the active paused pipeline for a project
   */
  getActivePausedPipeline(projectPath: string): PausedPipeline | null {
    return this.globalStore.getActivePausedPipeline(projectPath);
  }

  /**
   * List all paused pipelines
   */
  listPausedPipelines(status?: PausedPipelineStatus): PausedPipeline[] {
    return this.globalStore.listPausedPipelines(status);
  }

  /**
   * Resume a paused pipeline
   */
  async resumePipeline(pipelineId: string): Promise<boolean> {
    const pipeline = this.getPausedPipeline(pipelineId);
    if (!pipeline || pipeline.status !== 'paused') {
      return false;
    }

    const resumed = this.globalStore.resumePipeline(pipelineId);
    if (resumed) {
      // Log to CLI
      this.logPipelineResumed(pipeline);

      // Resolve associated errors
      this.errorHandler.resolveErrorsForService(
        pipeline.projectPath,
        pipeline.service,
        'reauth'
      );
    }

    return resumed;
  }

  /**
   * Cancel a paused pipeline
   */
  async cancelPipeline(pipelineId: string): Promise<boolean> {
    const pipeline = this.getPausedPipeline(pipelineId);
    if (!pipeline || pipeline.status !== 'paused') {
      return false;
    }

    const cancelled = this.globalStore.cancelPipeline(pipelineId);
    if (cancelled) {
      // Resolve associated errors as cancelled
      this.errorHandler.resolveErrorsForService(
        pipeline.projectPath,
        pipeline.service,
        'cancelled'
      );
    }

    return cancelled;
  }

  /**
   * Check if auth is restored for a service and resume all pipelines
   */
  async checkAndResumePipelines(service: AuthService): Promise<number> {
    // Get all paused pipelines for this service
    const pausedPipelines = this.listPausedPipelines('paused').filter(
      (p) => p.service === service
    );

    if (pausedPipelines.length === 0) {
      return 0;
    }

    // Check if auth is now valid
    const defaultSource = this.authSourceManager.getDefaultAuthSource(service);
    if (!defaultSource) {
      return 0;
    }

    const checkResult = await this.authSourceManager.verifySource(defaultSource.name);
    if (!checkResult.authenticated) {
      return 0;
    }

    // Resume all pipelines for this service
    const resumed = this.globalStore.resumePipelinesForService(service);

    // Send notification if any were resumed
    if (resumed > 0 && this.notificationService) {
      await this.notificationService.sendAuthRestored({
        service,
        sourceName: defaultSource.name,
        timestamp: new Date(),
      });
    }

    // Log to CLI
    if (resumed > 0) {
      console.log(
        chalk.green(`\n  Auth restored for ${service}. ${resumed} pipeline(s) resumed.\n`)
      );
    }

    return resumed;
  }

  /**
   * Handle an auth failure during pipeline execution
   * This is the main entry point for the pipeline controller
   */
  async handleAuthFailure(
    projectPath: string,
    jobId: string,
    requirementId: string,
    phase: string,
    service: AuthService,
    error: Error | string
  ): Promise<PausedPipeline> {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorType = this.errorHandler.classifyError(
      typeof error === 'string' ? new Error(error) : error
    );

    // Record the error
    const authError = this.errorHandler.recordError({
      projectPath,
      service,
      errorType,
      errorMessage,
      pipelineJobId: jobId,
    });

    // Pause the pipeline
    return this.pausePipeline({
      projectPath,
      jobId,
      requirementId,
      pausedPhase: phase,
      service,
      errorId: authError.id,
    });
  }

  /**
   * Check if there's a paused pipeline that can be resumed
   */
  async canResume(projectPath: string): Promise<boolean> {
    const pipeline = this.getActivePausedPipeline(projectPath);
    if (!pipeline) {
      return false;
    }

    // Check if auth is now valid
    const defaultSource = this.authSourceManager.getDefaultAuthSource(pipeline.service);
    if (!defaultSource) {
      return false;
    }

    const checkResult = await this.authSourceManager.verifySource(defaultSource.name);
    return checkResult.authenticated;
  }

  /**
   * Get recovery instructions for a paused pipeline
   */
  getRecoveryInstructions(pipeline: PausedPipeline): string {
    return `
${chalk.yellow('Pipeline Paused - Authentication Required')}

${chalk.dim('Project:')} ${pipeline.projectPath}
${chalk.dim('Service:')} ${pipeline.service}
${chalk.dim('Paused at:')} ${pipeline.pausedPhase} phase

${chalk.bold('To fix:')}
  ${chalk.cyan(`orchestrate auth fix ${pipeline.service}`)}

${chalk.bold('Or via Telegram:')}
  ${chalk.cyan(`/auth fix ${pipeline.service}`)}

${chalk.dim('The pipeline will automatically resume once authentication is restored.')}
`;
  }

  // --------------------------------------------------------------------------
  // CLI Logging
  // --------------------------------------------------------------------------

  private logPipelinePaused(pipeline: PausedPipeline, error: AuthError | null): void {
    console.log(chalk.red('\n  Pipeline Paused - Authentication Error\n'));
    console.log(chalk.dim(`  Project: ${pipeline.projectPath}`));
    console.log(chalk.dim(`  Service: ${pipeline.service}`));
    console.log(chalk.dim(`  Phase: ${pipeline.pausedPhase}`));
    if (error) {
      console.log(chalk.dim(`  Error: ${error.errorMessage}`));
    }
    console.log();
    console.log(chalk.yellow(`  To fix: orchestrate auth fix ${pipeline.service}`));
    console.log();
  }

  private logPipelineResumed(pipeline: PausedPipeline): void {
    console.log(chalk.green('\n  Pipeline Resumed\n'));
    console.log(chalk.dim(`  Project: ${pipeline.projectPath}`));
    console.log(chalk.dim(`  Service: ${pipeline.service}`));
    console.log(chalk.dim(`  Resuming from: ${pipeline.pausedPhase} phase`));
    console.log();
  }
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let authRecoveryInstance: AuthRecovery | null = null;

export function getAuthRecovery(): AuthRecovery {
  if (!authRecoveryInstance) {
    authRecoveryInstance = new AuthRecovery();
  }
  return authRecoveryInstance;
}

export { AuthRecovery as AuthRecoveryClass };
