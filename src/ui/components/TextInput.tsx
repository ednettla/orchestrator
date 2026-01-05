/**
 * TextInput Component
 *
 * Single-line text input with cursor and placeholder support.
 *
 * @module ui/components/TextInput
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../styles.js';

interface TextInputProps {
  message: string;
  placeholder?: string | undefined;
  initialValue?: string | undefined;
  onSubmit: (value: string) => void;
  onCancel?: (() => void) | undefined;
  validate?: ((value: string) => string | null) | undefined;
}

export function TextInput({
  message,
  placeholder = '',
  initialValue = '',
  onSubmit,
  onCancel,
  validate,
}: TextInputProps): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  const [cursorPosition, setCursorPosition] = useState(initialValue.length);
  const [error, setError] = useState<string | null>(null);

  const handleInput = useCallback((input: string, key: { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; leftArrow?: boolean; rightArrow?: boolean; ctrl?: boolean }) => {
    if (key.return) {
      // Validate if validator provided
      if (validate) {
        const validationError = validate(value);
        if (validationError) {
          setError(validationError);
          return;
        }
      }
      onSubmit(value || placeholder);
      return;
    }

    if (key.escape && onCancel) {
      onCancel();
      return;
    }

    if (key.backspace) {
      if (cursorPosition > 0) {
        const before = value.slice(0, cursorPosition - 1);
        const after = value.slice(cursorPosition);
        setValue(before + after);
        setCursorPosition(cursorPosition - 1);
        setError(null);
      }
      return;
    }

    if (key.delete) {
      if (cursorPosition < value.length) {
        const before = value.slice(0, cursorPosition);
        const after = value.slice(cursorPosition + 1);
        setValue(before + after);
        setError(null);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(Math.min(value.length, cursorPosition + 1));
      return;
    }

    // Handle Ctrl+A (select all / go to start)
    if (key.ctrl && input === 'a') {
      setCursorPosition(0);
      return;
    }

    // Handle Ctrl+E (go to end)
    if (key.ctrl && input === 'e') {
      setCursorPosition(value.length);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && input.length === 1) {
      const before = value.slice(0, cursorPosition);
      const after = value.slice(cursorPosition);
      setValue(before + input + after);
      setCursorPosition(cursorPosition + 1);
      setError(null);
    }
  }, [value, cursorPosition, placeholder, onSubmit, onCancel, validate]);

  useInput(handleInput);

  // Render the input with cursor
  const displayValue = value || '';
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const atCursor = displayValue[cursorPosition] || ' ';
  const afterCursor = displayValue.slice(cursorPosition + 1);

  const showPlaceholder = !value && placeholder;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={colors.text}>{message}</Text>
      </Box>
      <Box>
        <Text color={colors.primary}>{'\u276f'} </Text>
        {showPlaceholder ? (
          <Text color={colors.muted}>{placeholder}</Text>
        ) : (
          <>
            <Text color={colors.text}>{beforeCursor}</Text>
            <Text backgroundColor={colors.primary} color="black">{atCursor}</Text>
            <Text color={colors.text}>{afterCursor}</Text>
          </>
        )}
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color={colors.error}>{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={colors.muted}>Press Enter to submit, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
