/**
 * Unified Interaction System Types
 *
 * Defines platform-agnostic interaction primitives that map to:
 * - CLI: inquirer prompts (arrow keys, text input)
 * - Telegram: InlineKeyboard buttons, text messages
 *
 * @module interactions/types
 */

import type { Plan } from '../core/types.js';

// ============================================================================
// Interaction Primitives
// ============================================================================

/**
 * Option for select interactions
 */
export interface SelectOption {
  /** Unique identifier for this option */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon/emoji */
  icon?: string;
  /** Optional description (shown dimmed in CLI, ignored in Telegram) */
  description?: string;
  /** Whether this option is disabled */
  disabled?: boolean;
  /** Reason why option is disabled (shown to user) */
  disabledReason?: string;
}

/**
 * Select interaction - user picks one option from a list
 * CLI: Arrow keys + Enter
 * Telegram: InlineKeyboard buttons
 */
export interface SelectInteraction {
  type: 'select';
  /** Prompt message */
  message: string;
  /** Available options */
  options: SelectOption[];
}

/**
 * Input interaction - user enters text
 * CLI: Text input with readline
 * Telegram: Wait for text message
 */
export interface InputInteraction {
  type: 'input';
  /** Prompt message */
  message: string;
  /** Placeholder/default value */
  placeholder?: string;
  /** Whether to use multiline editor */
  multiline?: boolean;
  /** Validation function - returns error message or null */
  validate?: (value: string) => string | null;
}

/**
 * Confirm interaction - yes/no choice
 * CLI: Y/n prompt
 * Telegram: Two-button keyboard
 */
export interface ConfirmInteraction {
  type: 'confirm';
  /** Prompt message */
  message: string;
  /** Label for confirm button (default: "Yes") */
  confirmLabel?: string;
  /** Label for cancel button (default: "No") */
  cancelLabel?: string;
  /** Whether this is a destructive action (affects default) */
  destructive?: boolean;
}

/**
 * Progress interaction - show loading/working state
 * CLI: ora spinner
 * Telegram: Typing indicator
 */
export interface ProgressInteraction {
  type: 'progress';
  /** Loading message */
  message: string;
}

/**
 * Display interaction - show message to user
 * CLI: Console output with colored prefix
 * Telegram: Message reply
 */
export interface DisplayInteraction {
  type: 'display';
  /** Message to display */
  message: string;
  /** Message type affects styling */
  format?: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Union of all interaction types
 */
export type Interaction =
  | SelectInteraction
  | InputInteraction
  | ConfirmInteraction
  | ProgressInteraction
  | DisplayInteraction;

// ============================================================================
// Flow Context
// ============================================================================

/**
 * Requirements count by status
 */
export interface RequirementsCounts {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}

/**
 * Daemon status
 */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
}

/**
 * User context
 */
export interface UserContext {
  role: 'admin' | 'operator' | 'viewer';
  telegramId?: number;
  displayName?: string;
}

/**
 * Context passed to all flow steps
 * Contains current state of project, plan, requirements, etc.
 */
export interface FlowContext {
  /** Current working directory / project path */
  projectPath: string | null;
  /** Project name (if initialized) */
  projectName?: string;
  /** Session ID (if initialized) */
  sessionId?: string;
  /** Whether project is initialized */
  hasProject: boolean;
  /** Active plan (if any) */
  plan?: Plan | null;
  /** Requirement counts by status */
  requirements: RequirementsCounts;
  /** Daemon status */
  daemon: DaemonStatus;
  /** User context */
  user: UserContext;
  /** Platform identifier */
  platform: 'cli' | 'telegram';
  /** Wizard state for multi-step flows */
  wizardState?: Record<string, unknown>;
}

// ============================================================================
// Flow Definition
// ============================================================================

/**
 * A single step in a flow
 */
export interface FlowStep<TContext extends FlowContext = FlowContext> {
  /** Unique step identifier */
  id: string;

  /**
   * Build the interaction to show for this step
   * Return null to skip this step
   */
  interaction: (ctx: TContext) => Interaction | null;

  /**
   * Process user response
   * @param response - User's response (string for input/select, boolean for confirm)
   * @param ctx - Current flow context (can be mutated)
   * @returns Next step ID, or null to exit flow
   */
  handle: (response: unknown, ctx: TContext) => Promise<string | null>;

  /**
   * Called when navigating back to this step
   * Can clean up state if needed
   */
  onBack?: (ctx: TContext) => void;
}

/**
 * A complete flow definition
 */
export interface Flow<TContext extends FlowContext = FlowContext> {
  /** Unique flow identifier */
  id: string;
  /** Display name */
  name: string;
  /** ID of the first step */
  firstStep: string;
  /** All steps in this flow */
  steps: Record<string, FlowStep<TContext>>;
}

// ============================================================================
// Renderer Interface
// ============================================================================

/**
 * Handle for controlling progress indicator
 */
export interface ProgressHandle {
  /** Update the progress message */
  update(message: string): void;
  /** Mark as success and stop */
  succeed(message?: string): void;
  /** Mark as failure and stop */
  fail(message?: string): void;
  /** Stop without status */
  stop(): void;
}

/**
 * Platform-specific renderer interface
 *
 * Implementations:
 * - CLI: Uses inquirer prompts and ora spinner
 * - Telegram: Uses InlineKeyboard and typing indicator
 */
export interface Renderer {
  /**
   * Render a select interaction
   * @returns Selected option ID, or null if cancelled
   */
  select(interaction: SelectInteraction): Promise<string | null>;

  /**
   * Render an input interaction
   * @returns User input, or null if cancelled
   */
  input(interaction: InputInteraction): Promise<string | null>;

  /**
   * Render a confirm interaction
   * @returns true if confirmed, false if cancelled
   */
  confirm(interaction: ConfirmInteraction): Promise<boolean>;

  /**
   * Start a progress indicator
   * @returns Handle to control the progress
   */
  progress(interaction: ProgressInteraction): ProgressHandle;

  /**
   * Display a message
   */
  display(interaction: DisplayInteraction): Promise<void>;
}

// ============================================================================
// Flow Runner State
// ============================================================================

/**
 * Serializable flow session state (for persistence)
 */
export interface FlowSession {
  /** Flow ID */
  flowId: string;
  /** Current step ID */
  currentStepId: string;
  /** Step history for back navigation */
  stepHistory: string[];
  /** Context state */
  context: FlowContext;
  /** When this session started */
  startedAt: Date;
  /** When this session expires */
  expiresAt: Date;
}
