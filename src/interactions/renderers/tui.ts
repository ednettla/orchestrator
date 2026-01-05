/**
 * TUI Renderer
 *
 * Ink-based full-screen renderer for the CLI.
 * Implements the Renderer interface using React/Ink components.
 *
 * @module interactions/renderers/tui
 */

import React from 'react';
import { withFullScreen } from 'fullscreen-ink';
import { App } from '../../ui/App.js';
import { useAppState, type AppStateActions } from '../../ui/hooks/useAppState.js';
import type {
  Renderer,
  SelectInteraction,
  InputInteraction,
  ConfirmInteraction,
  ProgressInteraction,
  DisplayInteraction,
  ProgressHandle,
} from '../types.js';

// ============================================================================
// TUI App Wrapper
// ============================================================================

interface TuiAppState {
  actions: AppStateActions | null;
  instance: ReturnType<typeof withFullScreen> | null;
}

// Global state to hold the app actions
const tuiState: TuiAppState = {
  actions: null,
  instance: null,
};

// Promise resolvers for async operations
let readyResolver: ((actions: AppStateActions) => void) | null = null;

/**
 * Wrapper component that captures the app state actions
 */
function TuiAppWrapper({
  projectName,
}: {
  projectName?: string;
}): React.ReactElement {
  const [state, actions] = useAppState(projectName);

  // Capture actions on first render
  React.useEffect(() => {
    tuiState.actions = actions;
    if (readyResolver) {
      readyResolver(actions);
      readyResolver = null;
    }
  }, [actions]);

  return React.createElement(App, { state, actions });
}

// ============================================================================
// TUI Renderer Factory
// ============================================================================

/**
 * Create a TUI renderer instance
 *
 * This starts the Ink app in full-screen mode and returns a renderer
 * that can be used with the FlowRunner.
 *
 * @param projectName - Optional project name to display in header
 * @returns Promise that resolves to the renderer and a cleanup function
 */
export async function createTuiRenderer(
  projectName?: string
): Promise<{ renderer: Renderer; cleanup: () => void }> {
  // Create the app element
  const props: { projectName?: string } = {};
  if (projectName !== undefined) {
    props.projectName = projectName;
  }
  const appElement = React.createElement(TuiAppWrapper, props);

  // Create full-screen instance
  const instance = withFullScreen(appElement, {
    exitOnCtrlC: false, // We handle exit ourselves
  });
  tuiState.instance = instance;

  // Start the full-screen app (enters alternate buffer)
  await instance.start();

  // Wait for the app to be ready and capture actions (with timeout)
  const actions = await new Promise<AppStateActions>((resolve, reject) => {
    // Timeout after 5 seconds if React component doesn't initialize
    const timeout = setTimeout(() => {
      readyResolver = null;
      // Clean up the instance on timeout to exit alternate buffer
      if (tuiState.instance) {
        try {
          tuiState.instance.instance.unmount();
        } catch {
          // Ignore unmount errors during timeout cleanup
        }
        tuiState.instance = null;
      }
      tuiState.actions = null;
      reject(new Error('TUI initialization timed out - React component failed to mount'));
    }, 5000);

    if (tuiState.actions) {
      clearTimeout(timeout);
      resolve(tuiState.actions);
    } else {
      readyResolver = (actions) => {
        clearTimeout(timeout);
        resolve(actions);
      };
    }
  });

  const renderer: Renderer = {
    async select(interaction: SelectInteraction): Promise<string | null> {
      if (!tuiState.actions) {
        throw new Error('TUI not initialized');
      }
      return tuiState.actions.showMenu(interaction);
    },

    async input(interaction: InputInteraction): Promise<string | null> {
      if (!tuiState.actions) {
        throw new Error('TUI not initialized');
      }
      return tuiState.actions.showInput(interaction);
    },

    async confirm(interaction: ConfirmInteraction): Promise<boolean> {
      if (!tuiState.actions) {
        throw new Error('TUI not initialized');
      }
      return tuiState.actions.showConfirm(interaction);
    },

    progress(interaction: ProgressInteraction): ProgressHandle {
      if (!tuiState.actions) {
        throw new Error('TUI not initialized');
      }
      return tuiState.actions.showProgress(interaction);
    },

    async display(interaction: DisplayInteraction): Promise<void> {
      if (!tuiState.actions) {
        throw new Error('TUI not initialized');
      }
      return tuiState.actions.showDisplay(interaction);
    },
  };

  return {
    renderer,
    cleanup: () => {
      // Unmount the Ink instance to properly exit fullscreen mode
      if (tuiState.instance) {
        tuiState.instance.instance.unmount();
      }
      tuiState.actions = null;
      tuiState.instance = null;
    },
  };
}

/**
 * Update the project name displayed in the TUI header
 */
export function updateTuiProjectName(name: string | undefined): void {
  if (tuiState.actions) {
    tuiState.actions.setProjectName(name);
  }
}

/**
 * Exit the TUI gracefully
 */
export function exitTui(): void {
  if (tuiState.actions) {
    tuiState.actions.exit();
  }
}
