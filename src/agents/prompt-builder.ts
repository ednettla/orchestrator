import type { AgentType, TechStack, StructuredSpec } from '../core/types.js';

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildPrompt(agentType: AgentType, input: Record<string, unknown>): string {
  switch (agentType) {
    case 'planner':
      return buildPlannerPrompt(input);
    case 'architect':
      return buildArchitectPrompt(input);
    case 'coder':
      return buildCoderPrompt(input);
    case 'reviewer':
      return buildReviewerPrompt(input);
    case 'tester':
      return buildTesterPrompt(input);
    case 'decomposer':
      return buildDecomposerPrompt(input);
    case 'designer':
      return buildDesignerPrompt(input);
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

// ============================================================================
// Planner Prompt
// ============================================================================

function buildPlannerPrompt(input: Record<string, unknown>): string {
  const rawRequirement = input['rawRequirement'] as string;
  const techStack = input['techStack'] as TechStack;
  const projectName = input['projectName'] as string;

  return `# Project: ${projectName}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Testing: ${techStack.testing}
- Styling: ${techStack.styling}

## User Requirement
${rawRequirement}

## Your Task
Analyze this requirement and produce a structured specification with:
1. A clear title and description
2. User stories in "As a [role], I want [feature], so that [benefit]" format
3. Testable acceptance criteria (each with a unique ID like AC-1, AC-2, etc.)
4. Technical notes and considerations
5. Dependencies or prerequisites
6. Priority assessment

Output the specification as a JSON object matching the required schema.`;
}

// ============================================================================
// Architect Prompt
// ============================================================================

function buildArchitectPrompt(input: Record<string, unknown>): string {
  const structuredSpec = input['structuredSpec'] as StructuredSpec;
  const techStack = input['techStack'] as TechStack;
  const projectPath = input['projectPath'] as string;

  return `# Architecture Design Task

## Structured Specification
${JSON.stringify(structuredSpec, null, 2)}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Testing: ${techStack.testing}
- Styling: ${techStack.styling}

## Project Path
${projectPath}

## Your Task
1. First, explore the existing codebase structure using the available tools
2. Design the file/folder structure for the new feature
3. Define components, their responsibilities, and props
4. Design API endpoints with request/response schemas
5. Design database schema changes if needed
6. Create an ordered implementation plan

Read existing files to understand patterns and conventions.
Output the architecture as a JSON object matching the required schema.`;
}

// ============================================================================
// Coder Prompt
// ============================================================================

function buildCoderPrompt(input: Record<string, unknown>): string {
  const mode = input['mode'] as string | undefined;
  const structuredSpec = input['structuredSpec'] as StructuredSpec | undefined;
  const techStack = input['techStack'] as TechStack;
  const projectPath = input['projectPath'] as string;
  const issues = input['issues'] as Record<string, unknown> | undefined;

  if (mode === 'fix') {
    return `# Code Fix Task

## Issues to Fix
${JSON.stringify(issues, null, 2)}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Styling: ${techStack.styling}

## Project Path
${projectPath}

## Your Task
1. Read the files mentioned in the issues
2. Fix each issue according to the suggestions
3. Ensure fixes don't break other functionality
4. Run any necessary commands (linting, type checking)

Output a summary of changes as a JSON object.`;
  }

  return `# Implementation Task

## Structured Specification
${JSON.stringify(structuredSpec, null, 2)}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Styling: ${techStack.styling}

## Project Path
${projectPath}

## Your Task
1. Read the architecture documentation if it exists
2. Implement the feature according to the specification
3. Follow existing code patterns and conventions
4. Add proper error handling and TypeScript types
5. Install any necessary dependencies

Use the available tools to:
- Read existing files for context
- Write new files
- Edit existing files
- Run npm commands as needed

Output a summary of what was implemented as a JSON object.`;
}

// ============================================================================
// Reviewer Prompt
// ============================================================================

function buildReviewerPrompt(input: Record<string, unknown>): string {
  const techStack = input['techStack'] as TechStack;
  const projectPath = input['projectPath'] as string;

  return `# Code Review Task

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Styling: ${techStack.styling}

## Project Path
${projectPath}

## Your Task
1. Find recently modified or created files (check git status or file timestamps)
2. Review each file for:
   - Correctness and logic errors
   - Security vulnerabilities
   - Performance issues
   - Code style and conventions
   - Proper error handling
   - TypeScript type safety
   - Accessibility (for frontend components)

3. Run linting and type checking:
   - npm run lint (if available)
   - npm run typecheck or tsc --noEmit

4. Provide a structured review with:
   - passed: true/false
   - List of issues with severity, file, line, description, and fix suggestion
   - List of positive aspects

Be thorough but fair. Only mark passed=false for critical or multiple warning-level issues.
Output your review as a JSON object.`;
}

// ============================================================================
// Tester Prompt
// ============================================================================

function buildTesterPrompt(input: Record<string, unknown>): string {
  const structuredSpec = input['structuredSpec'] as StructuredSpec;
  const techStack = input['techStack'] as TechStack;
  const projectPath = input['projectPath'] as string;

  const useChromeMcp = techStack.testing === 'chrome-mcp';

  if (useChromeMcp) {
    return `# Browser Testing Task (Chrome MCP)

## Acceptance Criteria to Test
${JSON.stringify(structuredSpec?.acceptanceCriteria ?? [], null, 2)}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Testing: Chrome MCP (browser automation)

## Project Path
${projectPath}

## Your Task

Use Chrome MCP tools to test each acceptance criterion:

1. **Start the dev server** (if not running):
   \`npm run dev\`

2. **Navigate to the application** using \`mcp__claude-in-chrome__navigate\`

3. **For each acceptance criterion**:
   - Use \`mcp__claude-in-chrome__computer\` with action "screenshot" to capture initial state
   - Find elements using \`mcp__claude-in-chrome__find\` or \`mcp__claude-in-chrome__read_page\`
   - Interact using \`mcp__claude-in-chrome__computer\` (click, type) or \`mcp__claude-in-chrome__form_input\`
   - Verify expected outcomes
   - Take final screenshot

4. **Report results**:
   - Which criteria passed/failed
   - Steps taken for each test
   - Screenshots captured

Output your results as a JSON object with testsRun, failedCriteria, and allPassed fields.`;
  }

  // Cypress fallback
  return `# E2E Testing Task (Cypress)

## Acceptance Criteria to Test
${JSON.stringify(structuredSpec?.acceptanceCriteria ?? [], null, 2)}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Testing: Cypress

## Project Path
${projectPath}

## Your Task
1. Read the implementation to understand what was built
2. Generate Cypress E2E tests for each acceptance criterion
3. Each test should:
   - Have a descriptive name referencing the criterion ID
   - Use data-testid for element selection
   - Test both success and error cases
   - Be independent and parallelizable

4. Run the tests:
   - npx cypress run

5. Collect and report results:
   - Which tests passed/failed
   - Which acceptance criteria are verified
   - Error messages for failures

If tests fail, provide clear information about what failed so the coder can fix it.
Output your results as a JSON object.`;
}

// ============================================================================
// Decomposer Prompt
// ============================================================================

interface ClarifyingQuestionInput {
  id: string;
  category: string;
  question: string;
  context: string;
  suggestedOptions?: string[];
  answer?: string;
}

function buildDecomposerPrompt(input: Record<string, unknown>): string {
  const mode = input['mode'] as 'questions' | 'plan' | 'analyze';

  // Analyze mode is simpler - just needs the requirement
  if (mode === 'analyze') {
    const requirement = input['requirement'] as string;
    return buildDecomposerAnalyzePrompt(requirement);
  }

  const highLevelGoal = input['highLevelGoal'] as string;
  const techStack = input['techStack'] as TechStack;
  const projectName = input['projectName'] as string;

  if (mode === 'questions') {
    return buildDecomposerQuestionsPrompt(highLevelGoal, techStack, projectName);
  }

  const questions = input['questions'] as ClarifyingQuestionInput[];
  return buildDecomposerPlanPrompt(highLevelGoal, techStack, projectName, questions);
}

function buildDecomposerQuestionsPrompt(
  highLevelGoal: string,
  techStack: TechStack,
  projectName: string
): string {
  return `# Project: ${projectName}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Testing: ${techStack.testing}
- Styling: ${techStack.styling}

## High-Level Goal
${highLevelGoal}

## Your Task
You are a senior software architect conducting a requirements gathering session. Generate 5-10 clarifying questions to fully understand what needs to be built.

Questions should cover these categories:
1. **scope** - What features are must-have vs nice-to-have? What's the MVP?
2. **technical** - Any specific integrations, APIs, third-party services, or constraints?
3. **ux** - What should the user experience be like? Any specific interactions or flows?
4. **integration** - Does this need to integrate with existing systems?
5. **priority** - What's most important? What can be deferred?
6. **constraints** - Any deadlines, performance requirements, or limitations?

For each question:
- Be specific and actionable
- Provide context for why you're asking
- Include suggested options when applicable

Output as JSON:
\`\`\`json
{
  "questions": [
    {
      "id": "q1",
      "category": "scope",
      "question": "Your question here?",
      "context": "Why this is important...",
      "suggestedOptions": ["Option A", "Option B", "Option C"]
    }
  ]
}
\`\`\``;
}

function buildDecomposerPlanPrompt(
  highLevelGoal: string,
  techStack: TechStack,
  projectName: string,
  questions: ClarifyingQuestionInput[]
): string {
  const qAndA = questions
    .filter(q => q.answer)
    .map(q => `Q: ${q.question}\nA: ${q.answer}`)
    .join('\n\n');

  return `# Project: ${projectName}

## Tech Stack
- Frontend: ${techStack.frontend}
- Backend: ${techStack.backend}
- Database: ${techStack.database}
- Testing: ${techStack.testing}
- Styling: ${techStack.styling}

## High-Level Goal
${highLevelGoal}

## Requirements Gathering Q&A
${qAndA}

## Your Task
Based on the goal and the answered questions, create a comprehensive implementation plan.

Generate:
1. **Requirements** (5-15 detailed requirements)
   - Each must have clear acceptance criteria
   - Include dependencies between requirements (by ID)
   - Estimate complexity (low/medium/high)
   - Provide rationale for each requirement

2. **Architectural Decisions**
   - Key technology and design choices
   - Rationale and alternatives considered
   - Trade-offs

3. **Implementation Order**
   - Which requirements should be built first
   - Respect dependencies
   - Optimize for parallel execution where possible

4. **Assumptions & Scope**
   - What you're assuming based on the answers
   - What's explicitly out of scope
   - Risks and mitigations

Each requirement must be detailed enough for fully autonomous execution.

Output as JSON:
\`\`\`json
{
  "overview": "Brief summary of what will be built",
  "requirements": [
    {
      "id": "req-1",
      "title": "User Authentication",
      "description": "Implement user registration and login...",
      "userStories": ["As a user, I want to..."],
      "acceptanceCriteria": [
        {
          "id": "AC-1",
          "description": "User can register with email and password",
          "testable": true,
          "verified": false
        }
      ],
      "technicalNotes": ["Use bcrypt for password hashing..."],
      "estimatedComplexity": "medium",
      "dependencies": [],
      "priority": 1,
      "rationale": "Authentication is foundational..."
    }
  ],
  "architecturalDecisions": [
    {
      "id": "adr-1",
      "title": "Authentication Strategy",
      "decision": "Use JWT with refresh tokens",
      "rationale": "Stateless authentication for scalability",
      "alternatives": ["Session-based auth", "OAuth only"],
      "tradeoffs": "More complexity but better scalability"
    }
  ],
  "implementationOrder": ["req-1", "req-2", "req-3"],
  "assumptions": ["Users have modern browsers", "..."],
  "outOfScope": ["Mobile app", "..."],
  "risks": [
    {
      "id": "risk-1",
      "description": "Third-party API may have rate limits",
      "likelihood": "medium",
      "impact": "low",
      "mitigation": "Implement caching and retry logic"
    }
  ]
}
\`\`\``;
}

// ============================================================================
// Decomposer Analyze Mode
// ============================================================================

function buildDecomposerAnalyzePrompt(requirement: string): string {
  return `# Requirement Analysis Task

## Requirement to Analyze
"${requirement}"

## Your Task
Analyze whether this requirement needs to be decomposed into smaller, more manageable sub-requirements.

Consider these factors:
1. **Multiple Features**: Does it mention multiple distinct features or functionality?
2. **Specificity**: Is it specific enough for a single implementation task?
3. **Scope**: Can it reasonably be completed in 1-4 hours of focused work?
4. **Dependencies**: Does it imply building multiple independent components?
5. **Testability**: Can it be tested as a single unit, or would it need multiple test suites?

## Output Format
Output your analysis as JSON:
\`\`\`json
{
  "needsDecomposition": true,
  "reasoning": "This requirement should be decomposed because it mentions both user authentication and a dashboard with reports, which are distinct features that should be implemented separately.",
  "suggestedSubRequirements": [
    "Implement user registration with email and password",
    "Implement user login and session management",
    "Create dashboard layout with navigation",
    "Add report generation functionality",
    "Display reports on the dashboard"
  ]
}
\`\`\`

If the requirement is well-scoped and doesn't need decomposition:
\`\`\`json
{
  "needsDecomposition": false,
  "reasoning": "This requirement is focused on a single, well-defined feature that can be implemented in one session.",
  "suggestedSubRequirements": []
}
\`\`\`

Be helpful but not overly aggressive about decomposition. Simple, focused requirements should remain as-is.`;
}

// ============================================================================
// Designer Prompt
// ============================================================================

interface DesignIssueInput {
  id: string;
  category: string;
  severity: string;
  file: string;
  line?: number;
  description: string;
  currentValue?: string;
  suggestedValue?: string;
  autoFixable: boolean;
}

function buildDesignerPrompt(input: Record<string, unknown>): string {
  const mode = input['mode'] as 'generate' | 'audit' | 'fix';
  const techStack = input['techStack'] as TechStack;
  const projectPath = input['projectPath'] as string;

  if (mode === 'generate') {
    return buildDesignerGeneratePrompt(techStack, projectPath);
  } else if (mode === 'audit') {
    return buildDesignerAuditPrompt(techStack, projectPath);
  } else if (mode === 'fix') {
    const issues = input['issues'] as DesignIssueInput[];
    return buildDesignerFixPrompt(techStack, projectPath, issues);
  }

  throw new Error(`Unknown designer mode: ${mode}`);
}

function buildDesignerGeneratePrompt(techStack: TechStack, projectPath: string): string {
  return `# Design Tokens Setup

## Project Path
${projectPath}

## Your Task
Create a minimal design tokens file for this ${techStack.frontend} + ${techStack.styling} project.

Create ONE file: \`src/styles/tokens.ts\` with:

\`\`\`typescript
export const colors = {
  primary: { 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
  gray: { 50: '#f9fafb', 100: '#f3f4f6', 500: '#6b7280', 900: '#111827' },
  success: '#10b981',
  error: '#ef4444',
  warning: '#f59e0b',
};

export const spacing = {
  xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2rem'
};

export const fontSize = {
  sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem'
};
\`\`\`

Also create \`src/styles/index.ts\` that exports from tokens.

That's it - just these 2 small files. Do NOT create components or Storybook.

## Output Format
\`\`\`json
{
  "success": true,
  "filesCreated": ["src/styles/tokens.ts", "src/styles/index.ts"],
  "components": [],
  "storybookSetup": false,
  "notes": ["Created minimal design tokens. Use 'orchestrate design --component Button' to add components."]
}
\`\`\``;
}

function buildDesignerAuditPrompt(techStack: TechStack, projectPath: string): string {
  return `# UI Design Audit Task

## Tech Stack
- Frontend: ${techStack.frontend}
- Styling: ${techStack.styling}

## Project Path
${projectPath}

## Your Task
Perform a comprehensive UI audit of this existing project.

### Step 1: Scan the Codebase
Use the available tools to:
1. Find all component files (*.tsx, *.jsx, *.vue, *.svelte)
2. Find all style files (*.css, *.scss, *.module.css, tailwind classes)
3. Identify existing design tokens or theme files
4. Find inline styles and magic values

### Step 2: Analyze for Issues

**Color Consistency**
- Hardcoded color values (hex, rgb, hsl)
- Mismatched color palettes across components
- Missing semantic color usage (success/error/warning)
- Poor contrast ratios (a11y)

**Typography Issues**
- Inconsistent font sizes (magic numbers)
- Inconsistent font weights
- Hardcoded line-heights
- Missing responsive typography

**Spacing Violations**
- Magic number margins/padding
- Inconsistent spacing between similar elements
- Non-standard spacing values (not on 4px grid)

**Component Pattern Problems**
- Duplicated component implementations
- Inconsistent component APIs (different prop names for same thing)
- Missing variants that exist elsewhere
- Components that should be shared but aren't

**Code Quality Issues**
- Excessive inline styles
- Deeply nested CSS selectors
- Unused CSS classes
- Overly complex conditional styling
- Missing TypeScript types for style props

### Step 3: Generate Report
For each issue found, document:
- **id**: Unique identifier (e.g., "color-001")
- **category**: color | typography | spacing | pattern | code-quality
- **severity**: high | medium | low
- **file**: Path to the file
- **line**: Line number (if applicable)
- **description**: What's wrong
- **currentValue**: The problematic code/value
- **suggestedValue**: What it should be
- **autoFixable**: Whether this can be auto-fixed

### Severity Guidelines
- **high**: Accessibility issues, major inconsistencies affecting UX
- **medium**: Non-standard patterns, moderate inconsistencies
- **low**: Style suggestions, minor cleanup

## Output Format
\`\`\`json
{
  "summary": {
    "totalIssues": 42,
    "bySeverity": { "high": 5, "medium": 20, "low": 17 },
    "byCategory": {
      "color": 12,
      "typography": 8,
      "spacing": 10,
      "pattern": 7,
      "code-quality": 5
    }
  },
  "issues": [
    {
      "id": "color-001",
      "category": "color",
      "severity": "high",
      "file": "src/components/Button.tsx",
      "line": 24,
      "description": "Hardcoded color value instead of design token",
      "currentValue": "background-color: #3b82f6",
      "suggestedValue": "background-color: var(--color-primary-500)",
      "autoFixable": true
    }
  ],
  "recommendations": [
    "Create a centralized color palette in src/design-system/tokens/colors.ts",
    "Extract repeated button styles into a shared Button component"
  ],
  "existingPatterns": {
    "hasDesignSystem": false,
    "hasTheme": true,
    "stylingApproach": "mixed (tailwind + inline styles)"
  }
}
\`\`\``;
}

function buildDesignerFixPrompt(
  techStack: TechStack,
  projectPath: string,
  issues: DesignIssueInput[]
): string {
  const issuesByFile = issues.reduce((acc, issue) => {
    if (!acc[issue.file]) {
      acc[issue.file] = [];
    }
    acc[issue.file]!.push(issue);
    return acc;
  }, {} as Record<string, DesignIssueInput[]>);

  const issueList = Object.entries(issuesByFile)
    .map(([file, fileIssues]) => {
      const issueDetails = fileIssues
        .map(i => `  - [${i.severity}] ${i.description}
    Current: ${i.currentValue}
    Fix: ${i.suggestedValue}`)
        .join('\n');
      return `**${file}**\n${issueDetails}`;
    })
    .join('\n\n');

  return `# Design Fix Task

## Tech Stack
- Frontend: ${techStack.frontend}
- Styling: ${techStack.styling}

## Project Path
${projectPath}

## Issues to Fix
${issueList}

## Your Task
Fix the listed issues by:

1. Reading each file mentioned
2. Applying the suggested fixes
3. Ensuring consistency with any existing design tokens
4. If design tokens don't exist and are needed, create them first
5. Running any linting/formatting commands after changes

## Guidelines
- Preserve existing functionality - only change styling
- If creating new design tokens, follow this structure:
  \`\`\`
  src/design-system/
  ├── tokens/
  │   ├── colors.ts
  │   ├── typography.ts
  │   ├── spacing.ts
  │   └── index.ts
  └── index.ts
  \`\`\`
- Use semantic naming (e.g., \`--color-primary\` not \`--blue\`)
- Add comments explaining any non-obvious changes

## Output Format
\`\`\`json
{
  "success": true,
  "fixesApplied": 15,
  "filesModified": ["src/components/Button.tsx", ...],
  "tokensCreated": ["src/design-system/tokens/colors.ts"],
  "issuesRemaining": [],
  "notes": ["Created color palette from existing colors", ...]
}
\`\`\``;
}

