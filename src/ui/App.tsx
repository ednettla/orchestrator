/**
 * TUI App Shell
 *
 * Main full-screen application component for the Orchestrator CLI.
 * Renders the appropriate view based on current app state.
 *
 * @module ui/App
 */

import React, { useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Header, Footer, Menu, TextInput, Confirm, Spinner, Display } from './components/index.js';
import type { AppState, AppStateActions, ViewState } from './hooks/useAppState.js';
import type { MenuItem } from './components/Menu.js';

// ============================================================================
// Props
// ============================================================================

interface AppProps {
  state: AppState;
  actions: AppStateActions;
}

// ============================================================================
// View Components
// ============================================================================

interface ViewRendererProps {
  view: ViewState;
}

function ViewRenderer({ view }: ViewRendererProps): React.ReactElement | null {
  switch (view.type) {
    case 'menu': {
      const items: MenuItem[] = view.interaction.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        icon: opt.icon,
        description: opt.description,
        disabled: opt.disabled,
        disabledReason: opt.disabledReason,
      }));

      return (
        <Menu
          items={items}
          message={view.interaction.message}
          onSelect={(id) => view.resolve(id)}
          onCancel={() => view.resolve(null)}
        />
      );
    }

    case 'input':
      return (
        <TextInput
          message={view.interaction.message}
          placeholder={view.interaction.placeholder}
          onSubmit={(value) => view.resolve(value)}
          onCancel={() => view.resolve(null)}
          validate={view.interaction.validate}
        />
      );

    case 'confirm':
      return (
        <Confirm
          message={view.interaction.message}
          onConfirm={(confirmed) => view.resolve(confirmed)}
          destructive={view.interaction.destructive}
        />
      );

    case 'progress':
      return <Spinner message={view.message} state={view.state} />;

    case 'display':
      return <Display message={view.message} format={view.format} />;

    case 'idle':
    default:
      return null;
  }
}

// ============================================================================
// Footer Shortcuts
// ============================================================================

function getShortcuts(view: ViewState): Array<{ key: string; label: string }> {
  switch (view.type) {
    case 'menu':
      return [
        { key: '\u2191/\u2193', label: 'Navigate' },
        { key: 'Enter', label: 'Select' },
        { key: 'Esc', label: 'Back' },
        { key: 'q', label: 'Quit' },
      ];
    case 'input':
      return [
        { key: 'Enter', label: 'Submit' },
        { key: 'Esc', label: 'Cancel' },
      ];
    case 'confirm':
      return [
        { key: '\u2190/\u2192', label: 'Select' },
        { key: 'y/n', label: 'Quick' },
        { key: 'Enter', label: 'Confirm' },
      ];
    default:
      return [{ key: 'q', label: 'Quit' }];
  }
}

// ============================================================================
// Main App Component
// ============================================================================

export function App({ state, actions }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Handle global quit shortcut
  useInput((input, key) => {
    // Only handle 'q' when not in input mode
    if (input === 'q' && state.view.type !== 'input') {
      actions.exit();
    }
  });

  // Exit the app when exiting flag is set
  useEffect(() => {
    if (state.exiting) {
      exit();
    }
  }, [state.exiting, exit]);

  const shortcuts = getShortcuts(state.view);

  return (
    <Box flexDirection="column" height="100%">
      <Header projectName={state.projectName} />

      <Box flexGrow={1} flexDirection="column" paddingY={1}>
        <ViewRenderer view={state.view} />
      </Box>

      <Footer shortcuts={shortcuts} />
    </Box>
  );
}
