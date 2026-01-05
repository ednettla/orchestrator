/**
 * TextInput Component
 *
 * Text input with cursor, placeholder, and optional multiline support.
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
  multiline?: boolean | undefined;
  onSubmit: (value: string) => void;
  onCancel?: (() => void) | undefined;
  validate?: ((value: string) => string | null) | undefined;
}

export function TextInput({
  message,
  placeholder = '',
  initialValue = '',
  multiline = false,
  onSubmit,
  onCancel,
  validate,
}: TextInputProps): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  const [cursorPosition, setCursorPosition] = useState(initialValue.length);
  const [error, setError] = useState<string | null>(null);

  const handleInput = useCallback((input: string, key: { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; ctrl?: boolean; shift?: boolean; meta?: boolean }) => {
    // Submit on Enter (or Ctrl+Enter in multiline mode)
    if (key.return) {
      if (multiline && !key.ctrl && !key.meta) {
        // In multiline mode, regular Enter adds a newline
        const before = value.slice(0, cursorPosition);
        const after = value.slice(cursorPosition);
        setValue(before + '\n' + after);
        setCursorPosition(cursorPosition + 1);
        setError(null);
        return;
      }
      // Single-line or Ctrl+Enter: submit
      if (validate) {
        const validationError = validate(value);
        if (validationError) {
          setError(validationError);
          return;
        }
      }
      // Submit the actual value, not the placeholder
      onSubmit(value);
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

    // For multiline, handle up/down arrows to move between lines
    if (multiline && (key.upArrow || key.downArrow)) {
      const lines = value.split('\n');
      let lineStart = 0;
      let currentLine = 0;
      let posInLine = cursorPosition;

      // Find which line we're on and position within it
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined) {
          if (lineStart + line.length >= cursorPosition) {
            currentLine = i;
            posInLine = cursorPosition - lineStart;
            break;
          }
          lineStart += line.length + 1; // +1 for newline
        }
      }

      if (key.upArrow && currentLine > 0) {
        // Move to previous line
        const prevLine = lines[currentLine - 1];
        let newLineStart = 0;
        for (let i = 0; i < currentLine - 1; i++) {
          const line = lines[i];
          if (line !== undefined) {
            newLineStart += line.length + 1;
          }
        }
        const newPosInLine = prevLine ? Math.min(posInLine, prevLine.length) : 0;
        setCursorPosition(newLineStart + newPosInLine);
        return;
      }

      if (key.downArrow && currentLine < lines.length - 1) {
        // Move to next line
        const nextLine = lines[currentLine + 1];
        let newLineStart = 0;
        for (let i = 0; i <= currentLine; i++) {
          const line = lines[i];
          if (line !== undefined) {
            newLineStart += line.length + 1;
          }
        }
        const newPosInLine = nextLine ? Math.min(posInLine, nextLine.length) : 0;
        setCursorPosition(newLineStart + newPosInLine);
        return;
      }
    }

    // Handle Ctrl+A (go to start)
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
  }, [value, cursorPosition, placeholder, multiline, onSubmit, onCancel, validate]);

  useInput(handleInput);

  // Render multiline input
  if (multiline) {
    const lines = value.split('\n');
    let charCount = 0;

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color={colors.text}>{message}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="single" borderColor={colors.border} paddingX={1} paddingY={0}>
          {lines.length === 0 || (lines.length === 1 && lines[0] === '') ? (
            <Box>
              <Text color={colors.muted}>{placeholder || 'Type here...'}</Text>
            </Box>
          ) : (
            lines.map((line, lineIndex) => {
              const lineStart = charCount;
              charCount += line.length + 1; // +1 for newline

              // Check if cursor is on this line
              const cursorOnLine = cursorPosition >= lineStart && cursorPosition <= lineStart + line.length;

              if (!cursorOnLine) {
                return (
                  <Box key={lineIndex}>
                    <Text color={colors.text}>{line || ' '}</Text>
                  </Box>
                );
              }

              // Cursor is on this line
              const posInLine = cursorPosition - lineStart;
              const beforeCursor = line.slice(0, posInLine);
              const atCursor = line[posInLine] || ' ';
              const afterCursor = line.slice(posInLine + 1);

              return (
                <Box key={lineIndex}>
                  <Text color={colors.text}>{beforeCursor}</Text>
                  <Text backgroundColor={colors.primary} color="black">{atCursor}</Text>
                  <Text color={colors.text}>{afterCursor}</Text>
                </Box>
              );
            })
          )}
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={colors.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={colors.muted}>Enter for new line, Ctrl+Enter to submit, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Single-line input
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
