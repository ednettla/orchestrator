/**
 * CLI Renderer Tests
 *
 * Tests for the CLI renderer implementation.
 * Note: These tests mock @inquirer/prompts and ora.
 *
 * @module interactions/__tests__/renderers/cli.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
  editor: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn(function(this: { text: string }) { return this; }),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    text: '',
  })),
}));

import { cliRenderer, waitForEnter, printHeader, printBanner, printContextInfo } from '../../renderers/cli.js';
import { select, input, confirm, editor } from '@inquirer/prompts';
import ora from 'ora';

describe('cliRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('select', () => {
    it('calls inquirer select with choices', async () => {
      vi.mocked(select).mockResolvedValue('option1');

      const result = await cliRenderer.select({
        message: 'Choose an option:',
        options: [
          { id: 'option1', label: 'Option 1' },
          { id: 'option2', label: 'Option 2' },
        ],
      });

      expect(result).toBe('option1');
      expect(select).toHaveBeenCalledWith({
        message: 'Choose an option:',
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'option1' }),
          expect.objectContaining({ value: 'option2' }),
        ]),
      });
    });

    it('includes icons in display name', async () => {
      vi.mocked(select).mockResolvedValue('save');

      await cliRenderer.select({
        message: 'Choose:',
        options: [{ id: 'save', label: 'Save', icon: '💾' }],
      });

      expect(select).toHaveBeenCalledWith({
        message: 'Choose:',
        choices: [
          expect.objectContaining({
            name: expect.stringContaining('💾'),
            value: 'save',
          }),
        ],
      });
    });

    it('includes description in display name', async () => {
      vi.mocked(select).mockResolvedValue('run');

      await cliRenderer.select({
        message: 'Choose:',
        options: [{ id: 'run', label: 'Run', description: 'Execute the task' }],
      });

      expect(select).toHaveBeenCalledWith({
        message: 'Choose:',
        choices: [
          expect.objectContaining({
            name: expect.stringContaining('Execute the task'),
          }),
        ],
      });
    });

    it('marks disabled options', async () => {
      vi.mocked(select).mockResolvedValue('enabled');

      await cliRenderer.select({
        message: 'Choose:',
        options: [
          { id: 'enabled', label: 'Enabled' },
          { id: 'disabled', label: 'Disabled', disabled: true, disabledReason: 'Not available' },
        ],
      });

      expect(select).toHaveBeenCalledWith({
        message: 'Choose:',
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'disabled', disabled: 'Not available' }),
        ]),
      });
    });

    it('returns null on cancellation', async () => {
      vi.mocked(select).mockRejectedValue(new Error('User cancelled'));

      const result = await cliRenderer.select({
        message: 'Choose:',
        options: [{ id: 'opt', label: 'Option' }],
      });

      expect(result).toBeNull();
    });
  });

  describe('input', () => {
    it('calls inquirer input for single line', async () => {
      vi.mocked(input).mockResolvedValue('user input');

      const result = await cliRenderer.input({
        message: 'Enter value:',
      });

      expect(result).toBe('user input');
      expect(input).toHaveBeenCalledWith({
        message: 'Enter value:',
      });
    });

    it('includes placeholder as default', async () => {
      vi.mocked(input).mockResolvedValue('');

      await cliRenderer.input({
        message: 'Enter name:',
        placeholder: 'John Doe',
      });

      expect(input).toHaveBeenCalledWith({
        message: 'Enter name:',
        default: 'John Doe',
      });
    });

    it('includes validation function', async () => {
      vi.mocked(input).mockResolvedValue('valid');

      await cliRenderer.input({
        message: 'Enter:',
        validate: (v) => (v.length > 0 ? null : 'Required'),
      });

      expect(input).toHaveBeenCalledWith(
        expect.objectContaining({
          validate: expect.any(Function),
        })
      );
    });

    it('calls editor for multiline input', async () => {
      vi.mocked(editor).mockResolvedValue('multiline\ncontent');

      const result = await cliRenderer.input({
        message: 'Enter description:',
        multiline: true,
      });

      expect(result).toBe('multiline\ncontent');
      expect(editor).toHaveBeenCalledWith({
        message: 'Enter description:',
      });
      expect(input).not.toHaveBeenCalled();
    });

    it('returns null on cancellation', async () => {
      vi.mocked(input).mockRejectedValue(new Error('User cancelled'));

      const result = await cliRenderer.input({
        message: 'Enter:',
      });

      expect(result).toBeNull();
    });
  });

  describe('confirm', () => {
    it('calls inquirer confirm', async () => {
      vi.mocked(confirm).mockResolvedValue(true);

      const result = await cliRenderer.confirm({
        message: 'Are you sure?',
      });

      expect(result).toBe(true);
      expect(confirm).toHaveBeenCalledWith({
        message: 'Are you sure?',
        default: true,
      });
    });

    it('defaults to false for destructive actions', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      await cliRenderer.confirm({
        message: 'Delete file?',
        destructive: true,
      });

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          default: false,
        })
      );
    });

    it('returns false on cancellation', async () => {
      vi.mocked(confirm).mockRejectedValue(new Error('User cancelled'));

      const result = await cliRenderer.confirm({
        message: 'Confirm?',
      });

      expect(result).toBe(false);
    });
  });

  describe('progress', () => {
    it('creates ora spinner', () => {
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        text: '',
      };
      vi.mocked(ora).mockReturnValue(mockSpinner as unknown as ReturnType<typeof ora>);

      const handle = cliRenderer.progress({
        message: 'Loading...',
      });

      expect(ora).toHaveBeenCalledWith('Loading...');
      expect(mockSpinner.start).toHaveBeenCalled();
      expect(handle).toBeDefined();
    });

    it('update changes spinner text', () => {
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        text: '',
      };
      vi.mocked(ora).mockReturnValue(mockSpinner as unknown as ReturnType<typeof ora>);

      const handle = cliRenderer.progress({
        message: 'Loading...',
      });

      handle.update('Still loading...');

      expect(mockSpinner.text).toBe('Still loading...');
    });

    it('succeed stops spinner with success', () => {
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        text: '',
      };
      vi.mocked(ora).mockReturnValue(mockSpinner as unknown as ReturnType<typeof ora>);

      const handle = cliRenderer.progress({
        message: 'Loading...',
      });

      handle.succeed('Done!');

      expect(mockSpinner.succeed).toHaveBeenCalledWith('Done!');
    });

    it('succeed uses original message if not provided', () => {
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        text: '',
      };
      vi.mocked(ora).mockReturnValue(mockSpinner as unknown as ReturnType<typeof ora>);

      const handle = cliRenderer.progress({
        message: 'Loading...',
      });

      handle.succeed();

      expect(mockSpinner.succeed).toHaveBeenCalledWith('Loading...');
    });

    it('fail stops spinner with failure', () => {
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        text: '',
      };
      vi.mocked(ora).mockReturnValue(mockSpinner as unknown as ReturnType<typeof ora>);

      const handle = cliRenderer.progress({
        message: 'Loading...',
      });

      handle.fail('Error!');

      expect(mockSpinner.fail).toHaveBeenCalledWith('Error!');
    });

    it('stop stops spinner', () => {
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        text: '',
      };
      vi.mocked(ora).mockReturnValue(mockSpinner as unknown as ReturnType<typeof ora>);

      const handle = cliRenderer.progress({
        message: 'Loading...',
      });

      handle.stop();

      expect(mockSpinner.stop).toHaveBeenCalled();
    });
  });

  describe('display', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('displays info message', async () => {
      await cliRenderer.display({
        message: 'Info message',
        format: 'info',
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('displays success message', async () => {
      await cliRenderer.display({
        message: 'Success!',
        format: 'success',
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('displays warning message', async () => {
      await cliRenderer.display({
        message: 'Warning!',
        format: 'warning',
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('displays error message', async () => {
      await cliRenderer.display({
        message: 'Error!',
        format: 'error',
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('defaults to info format', async () => {
      await cliRenderer.display({
        message: 'Default message',
      });

      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});

describe('waitForEnter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls input with message', async () => {
    vi.mocked(input).mockResolvedValue('');

    await waitForEnter();

    expect(input).toHaveBeenCalled();
  });

  it('accepts custom message', async () => {
    vi.mocked(input).mockResolvedValue('');

    await waitForEnter('Hit enter...');

    expect(input).toHaveBeenCalled();
  });

  it('ignores cancellation', async () => {
    vi.mocked(input).mockRejectedValue(new Error('Cancelled'));

    // Should not throw
    await waitForEnter();
  });
});

describe('printHeader', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints header with title', () => {
    printHeader('Test Header');

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe('printBanner', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints banner', () => {
    printBanner();

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe('printContextInfo', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints no project message when not initialized', () => {
    printContextInfo({
      hasProject: false,
      requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
      daemon: { running: false },
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('prints project info when initialized', () => {
    printContextInfo({
      hasProject: true,
      projectName: 'my-project',
      requirements: { pending: 2, inProgress: 1, completed: 3, failed: 0 },
      daemon: { running: false },
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('prints daemon info when running', () => {
    printContextInfo({
      hasProject: true,
      projectName: 'my-project',
      requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
      daemon: { running: true, pid: 12345 },
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('prints plan info when available', () => {
    printContextInfo({
      hasProject: true,
      projectName: 'my-project',
      requirements: { pending: 0, inProgress: 0, completed: 0, failed: 0 },
      daemon: { running: false },
      plan: { status: 'pending_approval', highLevelGoal: 'Build a web app' },
    });

    expect(consoleSpy).toHaveBeenCalled();
  });
});
