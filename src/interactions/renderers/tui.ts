/**
 * TUI Renderer
 *
 * Ink-based full-screen renderer for the CLI.
 * Implements the Renderer interface using React/Ink components.
 *
 * @module interactions/renderers/tui
 */

import React from 'react';
import { render } from 'ink';
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
  cleanup: (() => void) | null;
}

// Global state to hold the app actions
const tuiState: TuiAppState = {
  actions: null,
  cleanup: null,
};

/**
 * Wrapper component that captures the app state actions
 */
function TuiAppWrapper({
  projectName,
  onReady,
}: {
  projectName?: string;
  onReady: (actions: AppStateActions) => void;
}): React.ReactElement {
  const [state, actions] = useAppState(projectName);

  // Capture actions on first render
  React.useEffect(() => {
    onReady(actions);
  }, [actions, onReady]);

  return React.createElement(App, { state, actions });
}

// ============================================================================
// TUI Renderer Factory
// ============================================================================

/**
 * Create a TUI renderer instance
 *
 * This starts the Ink app and returns a renderer that can be used
 * with the FlowRunner.
 *
 * @param projectName - Optional project name to display in header
 * @returns Promise that resolves to the renderer and a cleanup function
 */
export async function createTuiRenderer(
  projectName?: string
): Promise<{ renderer: Renderer; cleanup: () => void }> {
  return new Promise((resolve) => {
    const handleReady = (actions: AppStateActions): void => {
      tuiState.actions = actions;

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

      resolve({
        renderer,
        cleanup: () => {
          if (tuiState.cleanup) {
            tuiState.cleanup();
          }
          tuiState.actions = null;
          tuiState.cleanup = null;
        },
      });
    };

    // Render the app
    const props: { projectName?: string; onReady: (actions: AppStateActions) => void } = { onReady: handleReady };
    if (projectName !== undefined) {
      props.projectName = projectName;
    }
    const { unmount, waitUntilExit } = render(
      React.createElement(TuiAppWrapper, props)
    );

    tuiState.cleanup = unmount;

    // Handle app exit
    waitUntilExit().then(() => {
      tuiState.actions = null;
      tuiState.cleanup = null;
    });
  });
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
