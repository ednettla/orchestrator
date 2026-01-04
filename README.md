# Orchestrator

A multi-agent CLI tool for building full-stack web applications using Claude Code. Orchestrator decomposes high-level project goals into structured requirements, then executes them through a pipeline of specialized AI agents.

## Features

- **Multi-Agent Pipeline**: Specialized agents for planning, architecture, design, coding, review, and testing
- **Autonomous Planning**: Describe your project in plain English; Orchestrator breaks it down into implementable requirements
- **Concurrent Execution**: Run multiple requirements in parallel using git worktrees
- **Design System Generation**: Automatic creation of design tokens, base components, and Storybook stories
- **Unit Testing Integration**: Vitest setup with 80% coverage targets for all generated code
- **MCP Server Support**: Built-in Claude-in-Chrome integration for browser automation
- **State Persistence**: SQLite-based session management with checkpoint/resume support
- **CLAUDE.md Generation**: Automatic project context files for Claude Code

## Installation

### Quick Install (Recommended)

Run the installation script which handles everything automatically:

```bash
# Clone the repository
git clone https://github.com/yourusername/orchestrator.git
cd orchestrator

# Run the installer
./install.sh
```

The installer will:
- Check prerequisites (Node.js 20+, npm, git)
- Install dependencies and build
- Link `orchestrate` command globally
- Guide you through Claude Code authentication
- Provide Chrome extension setup instructions

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/orchestrator.git
cd orchestrator

# Install dependencies
npm install

# Build the project
npm run build

# Link globally
npm link

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Authenticate Claude Code
claude
```

## Requirements

- **Node.js >= 20.0.0** - [Download](https://nodejs.org)
- **Claude Code CLI** - Installed via npm, authenticate with `claude` command
- **Git** - For worktree-based concurrent execution
- **Chrome + Claude Extension** (optional) - For browser automation via Chrome MCP

## Quick Start

### 1. Initialize a Project

```bash
# Initialize in current directory
orchestrate init

# Initialize with tech stack detection
orchestrate init --detect

# Initialize with custom path and name
orchestrate init -p ./my-project -n "My App"

# Skip interactive prompts
orchestrate init --no-interactive
```

### 2. Add Requirements

```bash
# Add a single requirement
orchestrate add "Create a user authentication system with login and registration"

# Add with priority (higher runs first)
orchestrate add "Add password reset functionality" --priority 10
```

### 3. Run the Pipeline

```bash
# Run all pending requirements
orchestrate run

# Run a specific requirement
orchestrate run "Build a dashboard with analytics charts"

# Run sequentially instead of concurrently
orchestrate run --sequential

# Control concurrency
orchestrate run --concurrency 5
```

### 4. Autonomous Planning

For larger projects, use the `plan` command to let Orchestrator decompose your high-level goal:

```bash
orchestrate plan "Build a Sales CRM with contact management, deal tracking, and reporting"
```

This will:
1. Ask clarifying questions to understand scope
2. Generate a detailed implementation plan
3. Create structured requirements with acceptance criteria
4. Execute the plan after your approval

## Commands

| Command | Description |
|---------|-------------|
| `orchestrate init` | Initialize a new orchestrated project |
| `orchestrate add <requirement>` | Add a requirement to the queue |
| `orchestrate run [requirement]` | Execute requirements through the pipeline |
| `orchestrate plan <goal>` | Create and execute an autonomous project plan |
| `orchestrate resume` | Resume an interrupted session |
| `orchestrate status` | Show current session status and progress |
| `orchestrate list` | List all requirements |
| `orchestrate design` | Audit and manage design system |
| `orchestrate config` | View or update configuration |
| `orchestrate mcp` | Manage MCP server configurations |
| `orchestrate dashboard` | Interactive dashboard (TUI) |

## Architecture

### Agent Pipeline

Each requirement flows through a pipeline of specialized agents:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Planner   │ ──► │  Architect  │ ──► │  Designer   │
│  (analyze)  │     │  (design)   │     │ (UI/tokens) │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Tester    │ ◄── │  Reviewer   │ ◄── │   Coder     │
│   (E2E)     │     │  (review)   │     │ (implement) │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Agent Responsibilities

| Agent | Model | Purpose |
|-------|-------|---------|
| **Decomposer** | Opus | Breaks high-level goals into requirements |
| **Planner** | Opus | Analyzes requirements into structured specs |
| **Architect** | Opus | Designs system architecture and APIs |
| **Designer** | Opus | Creates design systems and UI components |
| **Coder** | Sonnet | Implements features with unit tests |
| **Reviewer** | Sonnet | Reviews code for quality and security |
| **Tester** | Sonnet | Writes and runs E2E tests |

### Concurrent Execution

Orchestrator uses git worktrees to run multiple requirements in parallel:

```
main/
├── .git/
├── .orchestrator/
│   └── worktrees/
│       ├── req-abc123/    # Requirement 1
│       ├── req-def456/    # Requirement 2
│       └── req-ghi789/    # Requirement 3
```

Each worktree gets its own isolated branch, allowing agents to work without conflicts.

## Tech Stack Support

Orchestrator supports multiple technology combinations:

### Frontend
- Next.js (default)
- React (Vite)
- Vue 3
- SvelteKit

### Backend
- Express (default)
- Fastify
- NestJS
- Hono

### Database
- PostgreSQL (default)
- SQLite
- MongoDB
- Supabase

### Testing
- **Browser/E2E**: Chrome MCP (default) or Cypress
- **Unit**: Vitest (always included)

### Styling
- Tailwind CSS (default)
- CSS Modules
- Styled Components

## Project Structure

When initialized, Orchestrator creates:

```
your-project/
├── .orchestrator/           # Orchestrator data directory
│   ├── orchestrator.db      # SQLite state database
│   ├── sessions/            # Session artifacts
│   ├── artifacts/           # Generated specs, reviews
│   ├── prompts/             # Agent prompt files
│   └── logs/                # Execution logs
├── CLAUDE.md                # Project context for Claude Code
├── vitest.config.ts         # Vitest configuration
└── ...                      # Your project files
```

## Configuration

### Init Options

```bash
orchestrate init [options]

Options:
  -p, --path <path>     Project path (default: current directory)
  -n, --name <name>     Project name
  --detect              Auto-detect tech stack from existing project
  --no-interactive      Skip interactive prompts and use defaults
  --no-design           Skip design system generation
  --no-claude-md        Skip CLAUDE.md generation
```

### MCP Server Management

```bash
# List configured MCP servers
orchestrate mcp list

# Add a custom MCP server
orchestrate mcp add my-server

# Enable/disable servers
orchestrate mcp enable context7
orchestrate mcp disable some-server

# Authorize a server for the project
orchestrate mcp auth github
```

### Design System

```bash
# Audit design consistency
orchestrate design --audit

# Apply auto-fixes
orchestrate design --fix

# Generate full design system
orchestrate design --generate

# Generate specific component
orchestrate design --component Button
```

## CLAUDE.md

Orchestrator generates a `CLAUDE.md` file that provides context for Claude Code:

- **Tech Stack**: Framework, database, testing, and styling choices
- **Project Structure**: Framework-specific directory layout
- **MCP Servers**: Available browser automation tools
- **Testing Requirements**: Unit test expectations and coverage targets
- **Code Conventions**: Framework-specific patterns and practices
- **Build Commands**: Common npm scripts

## Unit Testing

All code generated by the Coder agent includes unit tests:

- Test files use `.test.ts` or `.spec.ts` extension
- Tests are co-located with source files
- Coverage target: 80%
- Framework: Vitest with Testing Library

```bash
# Run tests
npm run test

# Run with coverage
npm run test:coverage

# Run with UI
npm run test:ui
```

## Browser Testing (Chrome MCP)

Orchestrator uses **Claude Chrome MCP** for browser automation and E2E testing instead of traditional frameworks like Playwright.

### Why Chrome MCP?
- **Real browser context**: Full access to Chrome DevTools
- **Interactive testing**: Test during development, not just in CI
- **Visual verification**: Take screenshots at each step
- **Natural language element finding**: Find elements by description, not just selectors

### Available Tools
| Tool | Purpose |
|------|---------|
| `navigate` | Navigate to URLs |
| `read_page` | Get accessibility tree of page |
| `find` | Find elements by natural language |
| `computer` | Click, type, scroll, screenshot |
| `form_input` | Fill form fields |
| `javascript_tool` | Execute JavaScript |

### Testing Workflow
1. Start dev server (`npm run dev`)
2. Navigate to application URL
3. Interact with elements using Chrome MCP tools
4. Take screenshots to verify state
5. Report test results

For CI/CD pipelines, Cypress can be used as a fallback testing framework.

## State Persistence

All state is stored in SQLite (`.orchestrator/orchestrator.db`):

- **Sessions**: Project configurations and status
- **Requirements**: User inputs and structured specs
- **Tasks**: Agent executions and outputs
- **Artifacts**: Generated file references
- **Checkpoints**: Pipeline state for resume
- **Jobs**: Concurrent execution tracking
- **Plans**: Autonomous planning data

## Loop Limits

To prevent runaway agent loops:

| Loop | Limit |
|------|-------|
| Review → Coder | 3 iterations |
| Test → Coder | 5 iterations |
| Total agent calls per requirement | 10 |

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## Project Layout

```
src/
├── cli/                # CLI commands
│   ├── commands/       # Individual command handlers
│   └── index.ts        # CLI entry point
├── core/               # Core services
│   ├── types.ts        # TypeScript types and schemas
│   ├── session-manager.ts
│   ├── claude-md-generator.ts
│   ├── vitest-setup.ts
│   ├── mcp-config-manager.ts
│   └── ...
├── agents/             # Agent system
│   ├── invoker.ts      # Agent invocation
│   └── prompt-builder.ts
├── pipeline/           # Execution pipeline
│   ├── controller.ts
│   └── concurrent-runner.ts
├── planning/           # Autonomous planning
│   ├── plan-controller.ts
│   └── plan-presenter.ts
├── design/             # Design system
│   ├── design-controller.ts
│   └── design-presenter.ts
└── state/              # State management
    └── store.ts        # SQLite store
```

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Acknowledgments

Built with:
- [Claude Code](https://claude.ai/claude-code) - AI coding assistant
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) - Interactive prompts
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite bindings
- [Zod](https://github.com/colinhacks/zod) - Schema validation
- [Chalk](https://github.com/chalk/chalk) - Terminal styling
- [Ora](https://github.com/sindresorhus/ora) - Terminal spinners
