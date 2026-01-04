declare module '@anthropic-ai/claude-code' {
  export interface QueryOptions {
    systemPrompt?: string;
    allowedTools?: string[];
    model?: 'opus' | 'sonnet' | 'haiku';
    maxTurns?: number;
    cwd?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    maxBudgetUsd?: number;
    agents?: Record<string, AgentDefinition>;
    mcpServers?: Record<string, unknown>;
  }

  export interface AgentDefinition {
    description: string;
    prompt: string;
    tools?: string[];
    model?: 'opus' | 'sonnet' | 'haiku' | 'inherit';
  }

  export interface QueryParams {
    prompt: string | AsyncIterable<QueryMessage>;
    options?: QueryOptions;
  }

  export interface QueryMessage {
    type: 'user' | 'assistant' | 'system';
    message?: {
      role: string;
      content: unknown;
    };
  }

  export interface StreamMessage {
    type: 'user' | 'assistant' | 'system' | 'result';
    subtype?: 'init' | 'success' | 'error';
    message?: {
      content: unknown;
    };
    session_id?: string;
    parent_tool_use_id?: string;
    result?: string;
    total_cost_usd?: number;
    error?: string;
  }

  export function query(params: QueryParams): AsyncIterable<StreamMessage>;
}
