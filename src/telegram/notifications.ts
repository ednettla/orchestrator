/**
 * Telegram Notifications
 *
 * Watch projects and send progress updates to users.
 *
 * @module telegram/notifications
 */

import type { Bot } from 'grammy';
import { getGlobalStore } from '../core/global-store.js';
import { getProjectRegistry } from '../core/project-registry.js';
import type { NotificationPayload, NotificationType, ProjectPhase } from './types.js';

// ============================================================================
// Types
// ============================================================================

interface ProjectWatcher {
  projectPath: string;
  projectName: string;
  lastPhase: ProjectPhase;
  lastLogLine: number;
  subscribers: number[];
}

// ============================================================================
// Notification Service
// ============================================================================

export class NotificationService {
  private bot: Bot | null = null;
  private watchers = new Map<string, ProjectWatcher>();
  private pollInterval: NodeJS.Timeout | null = null;
  private pollIntervalMs = 5000; // 5 seconds

  /**
   * Initialize the notification service
   */
  initialize(bot: Bot): void {
    this.bot = bot;
  }

  /**
   * Start watching projects for changes
   */
  startWatching(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      this.checkAllProjects().catch(console.error);
    }, this.pollIntervalMs);
  }

  /**
   * Stop watching projects
   */
  stopWatching(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Subscribe a user to project notifications
   */
  subscribe(telegramId: number, projectPath: string): void {
    let watcher = this.watchers.get(projectPath);

    if (!watcher) {
      const registry = getProjectRegistry();
      const project = registry.getProject(projectPath);

      if (!project) return;

      watcher = {
        projectPath,
        projectName: project.name,
        lastPhase: 'idle',
        lastLogLine: 0,
        subscribers: [],
      };
      this.watchers.set(projectPath, watcher);
    }

    if (!watcher.subscribers.includes(telegramId)) {
      watcher.subscribers.push(telegramId);
    }
  }

  /**
   * Unsubscribe a user from project notifications
   */
  unsubscribe(telegramId: number, projectPath: string): void {
    const watcher = this.watchers.get(projectPath);
    if (!watcher) return;

    watcher.subscribers = watcher.subscribers.filter((id) => id !== telegramId);

    if (watcher.subscribers.length === 0) {
      this.watchers.delete(projectPath);
    }
  }

  /**
   * Check all watched projects for changes
   */
  private async checkAllProjects(): Promise<void> {
    for (const [projectPath, watcher] of this.watchers) {
      await this.checkProject(projectPath, watcher);
    }
  }

  /**
   * Check a single project for changes
   */
  private async checkProject(projectPath: string, watcher: ProjectWatcher): Promise<void> {
    try {
      const { getProjectStatus } = await import('./project-bridge.js');
      const status = await getProjectStatus(projectPath);

      // Check for phase change
      if (status.phase !== watcher.lastPhase) {
        await this.notifyPhaseChange(watcher, status.phase);
        watcher.lastPhase = status.phase;
      }

      // Check for completion or failure
      if (status.phase === 'completed' || status.phase === 'failed') {
        await this.notifyCompletion(watcher, status.phase);
        // Auto-unsubscribe on completion
        this.watchers.delete(projectPath);
      }
    } catch (error) {
      console.error(`Error checking project ${projectPath}:`, error);
    }
  }

  /**
   * Notify subscribers of a phase change
   */
  private async notifyPhaseChange(watcher: ProjectWatcher, newPhase: ProjectPhase): Promise<void> {
    const payload: NotificationPayload = {
      type: 'phase_change',
      projectName: watcher.projectName,
      title: 'Phase Change',
      message: `${watcher.projectName} moved to ${newPhase} phase`,
    };

    await this.sendToSubscribers(watcher.subscribers, payload);
  }

  /**
   * Notify subscribers of completion
   */
  private async notifyCompletion(watcher: ProjectWatcher, phase: ProjectPhase): Promise<void> {
    const isSuccess = phase === 'completed';

    const payload: NotificationPayload = {
      type: isSuccess ? 'run_completed' : 'error',
      projectName: watcher.projectName,
      title: isSuccess ? 'Completed' : 'Failed',
      message: isSuccess
        ? `${watcher.projectName} completed successfully!`
        : `${watcher.projectName} failed. Check logs for details.`,
    };

    await this.sendToSubscribers(watcher.subscribers, payload);
  }

  /**
   * Send notification to all subscribers
   */
  private async sendToSubscribers(
    subscribers: number[],
    payload: NotificationPayload
  ): Promise<void> {
    if (!this.bot) return;

    const message = formatNotification(payload);
    const store = getGlobalStore();

    for (const telegramId of subscribers) {
      try {
        // Check user's notification level preference
        const config = store.getConfig();
        if (config.notificationLevel === 'minimal' && payload.type === 'phase_change') {
          continue; // Skip phase changes for minimal level
        }

        await this.bot.api.sendMessage(telegramId, message, {
          parse_mode: 'Markdown',
        });
      } catch (error) {
        console.error(`Failed to send notification to ${telegramId}:`, error);
      }
    }
  }

  /**
   * Send a direct notification to a user
   */
  async sendDirect(
    telegramId: number,
    payload: NotificationPayload
  ): Promise<boolean> {
    if (!this.bot) return false;

    try {
      const message = formatNotification(payload);
      await this.bot.api.sendMessage(telegramId, message, {
        parse_mode: 'Markdown',
      });
      return true;
    } catch (error) {
      console.error(`Failed to send direct notification to ${telegramId}:`, error);
      return false;
    }
  }

  /**
   * Notify about a plan ready for approval
   */
  async notifyPlanReady(projectPath: string, planSummary: string): Promise<void> {
    const watcher = this.watchers.get(projectPath);
    if (!watcher) return;

    const payload: NotificationPayload = {
      type: 'plan_ready',
      projectName: watcher.projectName,
      title: 'Plan Ready',
      message: `Plan ready for approval:\n\n${planSummary}`,
    };

    await this.sendToSubscribers(watcher.subscribers, payload);
  }
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a notification message
 */
function formatNotification(payload: NotificationPayload): string {
  const emoji = getNotificationEmoji(payload.type);
  const lines = [
    `${emoji} *${payload.title}*`,
    '',
    payload.message,
  ];

  if (payload.projectName) {
    lines.push('');
    lines.push(`_Project: ${payload.projectName}_`);
  }

  return lines.join('\n');
}

/**
 * Get emoji for notification type
 */
function getNotificationEmoji(type: NotificationType): string {
  switch (type) {
    case 'phase_change':
      return '📊';
    case 'requirement_completed':
      return '✅';
    case 'requirement_failed':
      return '❌';
    case 'plan_ready':
      return '📋';
    case 'run_completed':
      return '🎉';
    case 'error':
      return '⚠️';
    default:
      return '📢';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let notificationServiceInstance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
}
