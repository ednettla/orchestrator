# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm test               # Run Vitest tests
npm run test:coverage  # Run tests with coverage
npm run lint           # Run ESLint
npm link               # Link globally as `orchestrate` command
```

## Architecture Overview

Orchestrator is a multi-agent CLI tool that uses Claude Code to build full-stack web applications. It decomposes high-level requirements into structured specs, then executes them through a pipeline of specialized AI agents.

### Core Components

**Agent Pipeline** (`src/agents/`, `src/pipeline/`)
- `AgentInvoker` spawns Claude Code CLI processes with appropriate prompts and tools
- `PipelineController` orchestrates the sequential agent flow: Planner → Architect → Coder → Reviewer → Tester
- `ConcurrentRunner` enables parallel execution of multiple requirements using git worktrees
- Agents use `--print` mode with `--output-format stream-json` for real-time streaming

**State Management** (`src/state/store.ts`)
- SQLite database at `.orchestrator/orchestrator.db` using better-sqlite3
- Core entities: Session, Requirement, Task, Job, Worktree, Plan, Artifact, Checkpoint
- All state mutations go through the `StateStore` interface

**CLI Layer** (`src/cli/`)
- Entry point: `src/cli/index.ts` using Commander.js
- Commands in `src/cli/commands/` map to orchestrate subcommands
- Interactive menu when run without arguments

### Agent Types and Models

| Agent | Model | Purpose |
|-------|-------|---------|
| decomposer | opus | Breaks high-level goals into requirements |
| planner | opus | Analyzes requirements into structured specs |
| architect | opus | Designs system architecture and APIs |
| designer | opus | Creates design systems and UI components |
| coder | sonnet | Implements features with unit tests |
| reviewer | sonnet | Reviews code for quality and security |
| tester | sonnet | Writes and runs E2E tests |

### Concurrent Execution Flow

1. `ConcurrentRunner.runAll()` receives requirement IDs
2. For each requirement, creates a git worktree in `.orchestrator/worktrees/`
3. `PipelineController` runs independently in each worktree
4. Jobs tracked in database with phase/status updates
5. Worktrees merged back after completion

### Key Design Decisions

- **MCP Integration**: Runtime MCP config generated per agent invocation with credentials resolved from `CredentialManager`
- **Loop Limits**: Review→Coder limited to 3 iterations, Test→Coder to 5, total agent calls per requirement capped at 10
- **Retry Logic**: Exponential backoff with max 3 retries per agent call
- **Streaming**: Agents support `stream-json` output for real-time dashboard updates

### Testing Strategy

- Unit tests with Vitest, co-located with source files (`.test.ts`)
- E2E testing via Chrome MCP (default) or Cypress fallback
- Coverage target: 80%

## TypeScript Configuration

- Target: ES2022 with NodeNext modules
- Strict mode enabled with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Output to `dist/`, source in `src/`
