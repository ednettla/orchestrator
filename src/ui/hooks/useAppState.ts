/**
 * App State Hook
 *
 * Manages the TUI application state including current view,
 * pending interactions, and global keyboard handling.
 *
 * @module ui/hooks/useAppState
 */

import { useState, useCallback } from 'react';
import type {
  SelectInteraction,
  InputInteraction,
  ConfirmInteraction,
  ProgressInteraction,
  DisplayInteraction,
} from '../../interactions/types.js';
import type { DisplayFormat } from '../components/Display.js';

// ============================================================================
// View Types
// ============================================================================

export type ViewType = 'idle' | 'menu' | 'input' | 'confirm' | 'progress' | 'display';

export interface MenuViewState {
  type: 'menu';
  interaction: SelectInteraction;
  resolve: (value: string | null) => void;
}

export interface InputViewState {
  type: 'input';
  interaction: InputInteraction;
  resolve: (value: string | null) => void;
}

export interface ConfirmViewState {
  type: 'confirm';
  interaction: ConfirmInteraction;
  resolve: (value: boolean) => void;
}

export interface ProgressViewState {
  type: 'progress';
  message: string;
  state: 'spinning' | 'success' | 'error';
}

export interface DisplayViewState {
  type: 'display';
  message: string;
  format: DisplayFormat;
  resolve: () => void;
}

export interface IdleViewState {
  type: 'idle';
}

export type ViewState =
  | IdleViewState
  | MenuViewState
  | InputViewState
  | ConfirmViewState
  | ProgressViewState
  | DisplayViewState;

// ============================================================================
// App State
// ============================================================================

export interface AppState {
  view: ViewState;
  projectName?: string | undefined;
  error?: string | undefined;
  exiting: boolean;
}

export interface AppStateActions {
  showMenu: (interaction: SelectInteraction) => Promise<string | null>;
  showInput: (interaction: InputInteraction) => Promise<string | null>;
  showConfirm: (interaction: ConfirmInteraction) => Promise<boolean>;
  showProgress: (interaction: ProgressInteraction) => {
    update: (message: string) => void;
    succeed: (message?: string) => void;
    fail: (message?: string) => void;
    stop: () => void;
  };
  showDisplay: (interaction: DisplayInteraction) => Promise<void>;
  setProjectName: (name: string | undefined) => void;
  setError: (error: string | undefined) => void;
  exit: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useAppState(initialProjectName?: string): [AppState, AppStateActions] {
  const [state, setState] = useState<AppState>({
    view: { type: 'idle' },
    projectName: initialProjectName,
    exiting: false,
  });

  const showMenu = useCallback((interaction: SelectInteraction): Promise<string | null> => {
    return new Promise((resolve) => {
      setState((prev) => ({
        ...prev,
        view: { type: 'menu', interaction, resolve },
      }));
    });
  }, []);

  const showInput = useCallback((interaction: InputInteraction): Promise<string | null> => {
    return new Promise((resolve) => {
      setState((prev) => ({
        ...prev,
        view: { type: 'input', interaction, resolve },
      }));
    });
  }, []);

  const showConfirm = useCallback((interaction: ConfirmInteraction): Promise<boolean> => {
    return new Promise((resolve) => {
      setState((prev) => ({
        ...prev,
        view: { type: 'confirm', interaction, resolve },
      }));
    });
  }, []);

  const showProgress = useCallback((interaction: ProgressInteraction) => {
    setState((prev) => ({
      ...prev,
      view: { type: 'progress', message: interaction.message, state: 'spinning' },
    }));

    return {
      update: (message: string) => {
        setState((prev) => {
          if (prev.view.type === 'progress') {
            return { ...prev, view: { ...prev.view, message } };
          }
          return prev;
        });
      },
      succeed: (message?: string) => {
        setState((prev) => {
          if (prev.view.type === 'progress') {
            return {
              ...prev,
              view: { type: 'progress', message: message ?? prev.view.message, state: 'success' },
            };
          }
          return prev;
        });
        // Auto-clear after a short delay
        setTimeout(() => {
          setState((prev) => {
            if (prev.view.type === 'progress' && prev.view.state === 'success') {
              return { ...prev, view: { type: 'idle' } };
            }
            return prev;
          });
        }, 500);
      },
      fail: (message?: string) => {
        setState((prev) => {
          if (prev.view.type === 'progress') {
            return {
              ...prev,
              view: { type: 'progress', message: message ?? prev.view.message, state: 'error' },
            };
          }
          return prev;
        });
      },
      stop: () => {
        setState((prev) => {
          if (prev.view.type === 'progress') {
            return { ...prev, view: { type: 'idle' } };
          }
          return prev;
        });
      },
    };
  }, []);

  const showDisplay = useCallback((interaction: DisplayInteraction): Promise<void> => {
    return new Promise((resolve) => {
      setState((prev) => ({
        ...prev,
        view: {
          type: 'display',
          message: interaction.message,
          format: interaction.format ?? 'info',
          resolve,
        },
      }));
      // Auto-resolve display messages after a short delay to allow reading
      setTimeout(() => {
        resolve();
        setState((prev) => {
          if (prev.view.type === 'display') {
            return { ...prev, view: { type: 'idle' } };
          }
          return prev;
        });
      }, 1500);
    });
  }, []);

  const setProjectName = useCallback((name: string | undefined) => {
    setState((prev) => ({ ...prev, projectName: name }));
  }, []);

  const setError = useCallback((error: string | undefined) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const exit = useCallback(() => {
    setState((prev) => ({ ...prev, exiting: true }));
  }, []);

  return [
    state,
    {
      showMenu,
      showInput,
      showConfirm,
      showProgress,
      showDisplay,
      setProjectName,
      setError,
      exit,
    },
  ];
}
