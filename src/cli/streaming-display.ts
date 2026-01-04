import chalk from 'chalk';
import type { ClaudeStreamMessage, StreamMessageContent } from '../agents/invoker.js';

/**
 * StreamingDisplay handles real-time display of Claude's output
 * including thinking, tool usage, and assistant text.
 */
export class StreamingDisplay {
  private lastToolName: string = '';
  private inThinking: boolean = false;

  /**
   * Process and display a streaming message from Claude CLI
   */
  display(message: ClaudeStreamMessage): void {
    if (message.type === 'assistant' && message.message?.content) {
      this.displayAssistantContent(message.message.content);
    } else if (message.type === 'result') {
      this.displayResult(message);
    } else if (message.type === 'system' && message.subtype === 'error') {
      this.displayError(message.error);
    }
  }

  private displayAssistantContent(content: StreamMessageContent[] | string): void {
    if (typeof content === 'string') {
      process.stdout.write(content);
      return;
    }

    for (const block of content) {
      switch (block.type) {
        case 'thinking':
          this.displayThinking(block.thinking ?? '');
          break;
        case 'text':
          this.displayText(block.text ?? '');
          break;
        case 'tool_use':
          this.displayToolUse(block.name ?? 'unknown', block.input);
          break;
        case 'tool_result':
          this.displayToolResult(block.content);
          break;
      }
    }
  }

  private displayThinking(thinking: string): void {
    if (!thinking.trim()) return;

    // End thinking indicator if we were in thinking mode
    if (!this.inThinking) {
      this.inThinking = true;
    }

    // Display thinking lines in dim gray
    const lines = thinking.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        const formatted = this.formatThinkingLine(line);
        console.log(chalk.dim.gray(`  ${formatted}`));
      }
    }
  }

  private formatThinkingLine(line: string): string {
    // Truncate long lines
    const maxLength = process.stdout.columns ? process.stdout.columns - 10 : 70;
    if (line.length > maxLength) {
      return line.substring(0, maxLength - 3) + '...';
    }
    return line;
  }

  private displayText(text: string): void {
    if (!text) return;

    // End thinking mode if we were in it
    if (this.inThinking) {
      this.inThinking = false;
      console.log(); // Add blank line after thinking
    }

    // Normal color for assistant text
    process.stdout.write(text);
  }

  private displayToolUse(toolName: string, input: unknown): void {
    // End thinking mode if we were in it
    if (this.inThinking) {
      this.inThinking = false;
      console.log();
    }

    this.lastToolName = toolName;
    const briefArgs = this.formatToolArgs(toolName, input);
    console.log(chalk.cyan(`  [${toolName}] ${briefArgs}`));
  }

  private formatToolArgs(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return '';

    const inp = input as Record<string, unknown>;

    switch (toolName) {
      case 'Read':
        return chalk.dim(this.shortenPath(String(inp.file_path ?? '')));
      case 'Write':
        return chalk.dim(this.shortenPath(String(inp.file_path ?? '')));
      case 'Edit':
        return chalk.dim(this.shortenPath(String(inp.file_path ?? '')));
      case 'Glob':
        return chalk.dim(String(inp.pattern ?? ''));
      case 'Grep':
        return chalk.dim(`"${inp.pattern}" in ${this.shortenPath(String(inp.path ?? '.'))}`);
      case 'Bash':
        const cmd = String(inp.command ?? '');
        return chalk.dim(cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd);
      case 'Task':
        return chalk.dim(String(inp.description ?? ''));
      default:
        return '';
    }
  }

  private shortenPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 2) return path;
    return parts.slice(-2).join('/');
  }

  private displayToolResult(content: unknown): void {
    // Brief result indication
    if (content && typeof content === 'string') {
      const lines = content.split('\n').length;
      if (lines > 1) {
        console.log(chalk.dim(`    -> ${lines} lines`));
      }
    } else if (content && typeof content === 'object') {
      console.log(chalk.dim(`    -> result`));
    }
  }

  private displayResult(message: ClaudeStreamMessage): void {
    // End thinking mode if we were in it
    if (this.inThinking) {
      this.inThinking = false;
      console.log();
    }

    if (message.subtype === 'success') {
      if (message.total_cost_usd) {
        console.log(chalk.dim(`\n  Cost: $${message.total_cost_usd.toFixed(4)}`));
      }
    } else if (message.subtype === 'error') {
      this.displayError(message.error);
    }
  }

  private displayError(error?: string): void {
    if (error) {
      console.error(chalk.red(`  Error: ${error}`));
    }
  }
}
