/**
 * Simple Flow Tests
 *
 * Tests for simple delegation flows (secrets, projects, telegram-settings).
 *
 * @module interactions/__tests__/flows/simple-flows.test
 */

import { describe, it, expect } from 'vitest';
import {
  secretsFlow,
  isSecretsAction,
  getSecretsAction,
  type SecretsFlowContext,
} from '../../flows/secrets.js';
import {
  projectsFlow,
  isProjectsAction,
  getProjectsAction,
  type ProjectsFlowContext,
} from '../../flows/projects.js';
import {
  telegramSettingsFlow,
  isTelegramSettingsAction,
  getTelegramSettingsAction,
  type TelegramSettingsFlowContext,
} from '../../flows/telegram-settings.js';
import { createMockContext } from '../mocks/context.js';

describe('secretsFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(secretsFlow.id).toBe('secrets');
      expect(secretsFlow.name).toBe('Secrets Management');
    });

    it('starts at check_platform step', () => {
      expect(secretsFlow.firstStep).toBe('check_platform');
    });
  });

  describe('check_platform step', () => {
    it('shows progress', () => {
      const ctx = createMockContext() as SecretsFlowContext;
      const interaction = secretsFlow.steps.check_platform.interaction(ctx);

      expect(interaction.type).toBe('progress');
    });

    it('triggers action', async () => {
      const ctx = createMockContext() as SecretsFlowContext;
      const result = await secretsFlow.steps.check_platform.handle(null, ctx);

      expect(result).toBe('action:run_secrets_interactive');
    });
  });

  describe('cli_only step', () => {
    it('shows warning for telegram', () => {
      const ctx = createMockContext() as SecretsFlowContext;
      const interaction = secretsFlow.steps.cli_only.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('warning');
      expect(interaction.message).toContain('only available in CLI');
    });

    it('exits flow', async () => {
      const ctx = createMockContext() as SecretsFlowContext;
      const result = await secretsFlow.steps.cli_only.handle(null, ctx);

      expect(result).toBeNull();
    });
  });

  describe('error step', () => {
    it('shows error and exits', async () => {
      const ctx = createMockContext() as SecretsFlowContext;
      ctx.error = 'Error';

      const interaction = secretsFlow.steps.error.interaction(ctx);
      expect(interaction.format).toBe('error');

      const result = await secretsFlow.steps.error.handle(null, ctx);
      expect(result).toBeNull();
    });
  });
});

describe('isSecretsAction', () => {
  it('returns true for action markers', () => {
    expect(isSecretsAction('action:test')).toBe(true);
  });

  it('returns false for non-action results', () => {
    expect(isSecretsAction('menu')).toBe(false);
    expect(isSecretsAction(null)).toBe(false);
  });
});

describe('getSecretsAction', () => {
  it('extracts action name', () => {
    expect(getSecretsAction('action:test')).toBe('test');
  });
});

describe('projectsFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(projectsFlow.id).toBe('projects');
      expect(projectsFlow.name).toBe('Project Registry');
    });

    it('starts at check_platform step', () => {
      expect(projectsFlow.firstStep).toBe('check_platform');
    });
  });

  describe('check_platform step', () => {
    it('shows progress', () => {
      const ctx = createMockContext() as ProjectsFlowContext;
      const interaction = projectsFlow.steps.check_platform.interaction(ctx);

      expect(interaction.type).toBe('progress');
    });

    it('triggers action', async () => {
      const ctx = createMockContext() as ProjectsFlowContext;
      const result = await projectsFlow.steps.check_platform.handle(null, ctx);

      expect(result).toBe('action:run_projects_interactive');
    });
  });

  describe('cli_only step', () => {
    it('shows warning for telegram', () => {
      const ctx = createMockContext() as ProjectsFlowContext;
      const interaction = projectsFlow.steps.cli_only.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('warning');
      expect(interaction.message).toContain('only available in CLI');
    });

    it('exits flow', async () => {
      const ctx = createMockContext() as ProjectsFlowContext;
      const result = await projectsFlow.steps.cli_only.handle(null, ctx);

      expect(result).toBeNull();
    });
  });

  describe('error step', () => {
    it('shows error and exits', async () => {
      const ctx = createMockContext() as ProjectsFlowContext;
      ctx.error = 'Error';

      const interaction = projectsFlow.steps.error.interaction(ctx);
      expect(interaction.format).toBe('error');

      const result = await projectsFlow.steps.error.handle(null, ctx);
      expect(result).toBeNull();
    });
  });
});

describe('isProjectsAction', () => {
  it('returns true for action markers', () => {
    expect(isProjectsAction('action:list')).toBe(true);
  });

  it('returns false for non-action results', () => {
    expect(isProjectsAction('menu')).toBe(false);
    expect(isProjectsAction(null)).toBe(false);
  });
});

describe('getProjectsAction', () => {
  it('extracts action name', () => {
    expect(getProjectsAction('action:list')).toBe('list');
  });
});

describe('telegramSettingsFlow', () => {
  describe('flow metadata', () => {
    it('has correct id and name', () => {
      expect(telegramSettingsFlow.id).toBe('telegram-settings');
      expect(telegramSettingsFlow.name).toBe('Telegram Bot Settings');
    });

    it('starts at check_platform step', () => {
      expect(telegramSettingsFlow.firstStep).toBe('check_platform');
    });
  });

  describe('check_platform step', () => {
    it('shows progress', () => {
      const ctx = createMockContext() as TelegramSettingsFlowContext;
      const interaction = telegramSettingsFlow.steps.check_platform.interaction(ctx);

      expect(interaction.type).toBe('progress');
    });

    it('triggers action', async () => {
      const ctx = createMockContext() as TelegramSettingsFlowContext;
      const result = await telegramSettingsFlow.steps.check_platform.handle(null, ctx);

      expect(result).toBe('action:run_telegram_interactive');
    });
  });

  describe('cli_only step', () => {
    it('shows warning', () => {
      const ctx = createMockContext() as TelegramSettingsFlowContext;
      const interaction = telegramSettingsFlow.steps.cli_only.interaction(ctx);

      expect(interaction.type).toBe('display');
      expect(interaction.format).toBe('warning');
    });
  });

  describe('error step', () => {
    it('shows error and exits', async () => {
      const ctx = createMockContext() as TelegramSettingsFlowContext;
      ctx.error = 'Error';

      const interaction = telegramSettingsFlow.steps.error.interaction(ctx);
      expect(interaction.format).toBe('error');

      const result = await telegramSettingsFlow.steps.error.handle(null, ctx);
      expect(result).toBeNull();
    });
  });
});

describe('isTelegramSettingsAction', () => {
  it('returns true for action markers', () => {
    expect(isTelegramSettingsAction('action:test')).toBe(true);
  });

  it('returns false for non-action results', () => {
    expect(isTelegramSettingsAction('menu')).toBe(false);
    expect(isTelegramSettingsAction(null)).toBe(false);
  });
});

describe('getTelegramSettingsAction', () => {
  it('extracts action name', () => {
    expect(getTelegramSettingsAction('action:test')).toBe('test');
  });
});
