import type { SessionManager } from './session-manager.js';
import { AgentInvoker } from '../agents/invoker.js';
import type { Task } from './types.js';
import { nanoid } from 'nanoid';

// ============================================================================
// Requirement Analyzer
// ============================================================================

export interface AnalysisResult {
  needsDecomposition: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  heuristicFlags: string[];
  suggestedSubRequirements?: string[];
}

interface HeuristicResult {
  needsDecomposition: boolean;
  confidence: 'high' | 'medium' | 'low';
  flags: string[];
}

/**
 * Analyzes requirements to determine if they need decomposition.
 * Uses a two-phase approach:
 * 1. Fast heuristics for quick decisions
 * 2. AI analysis when heuristics are uncertain
 */
export class RequirementAnalyzer {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Analyze a requirement to determine if it needs decomposition
   */
  async analyze(requirement: string): Promise<AnalysisResult> {
    // Phase 1: Fast heuristics
    const heuristicResult = this.runHeuristics(requirement);

    // If heuristics are confident, return immediately
    if (heuristicResult.confidence === 'high') {
      return {
        needsDecomposition: heuristicResult.needsDecomposition,
        confidence: 'high',
        reasoning: this.buildHeuristicReasoning(heuristicResult),
        heuristicFlags: heuristicResult.flags,
      };
    }

    // Phase 2: AI analysis for uncertain cases
    try {
      const aiResult = await this.runAIAnalysis(requirement);
      return {
        ...aiResult,
        heuristicFlags: heuristicResult.flags,
      };
    } catch (error) {
      // Fall back to heuristic result if AI fails
      return {
        needsDecomposition: heuristicResult.needsDecomposition,
        confidence: heuristicResult.confidence,
        reasoning: this.buildHeuristicReasoning(heuristicResult),
        heuristicFlags: heuristicResult.flags,
      };
    }
  }

  /**
   * Phase 1: Run fast heuristic checks
   */
  private runHeuristics(requirement: string): HeuristicResult {
    const flags: string[] = [];
    let score = 0;

    const lowerReq = requirement.toLowerCase();

    // Check 1: Multiple "and" conjunctions (suggests multiple features)
    const andCount = (lowerReq.match(/\band\b/g) ?? []).length;
    if (andCount >= 3) {
      flags.push('Multiple "and" conjunctions');
      score += 3;
    } else if (andCount >= 2) {
      flags.push('Contains multiple "and" conjunctions');
      score += 2;
    }

    // Check 2: List structures (commas with action words, numbered items)
    const commaWithActions = requirement.match(/,\s*(add|create|implement|build|make|update|fix)/gi);
    if (commaWithActions && commaWithActions.length >= 2) {
      flags.push('List of actions detected');
      score += 3;
    }

    // Check 3: Enumeration words
    const enumerationWords = ['multiple', 'several', 'various', 'all', 'every', 'each'];
    for (const word of enumerationWords) {
      if (lowerReq.includes(word)) {
        flags.push(`Enumeration word: "${word}"`);
        score += 2;
        break;
      }
    }

    // Check 4: Length check (very long requirements often need decomposition)
    if (requirement.length > 300) {
      flags.push('Very long requirement (>300 chars)');
      score += 3;
    } else if (requirement.length > 200) {
      flags.push('Long requirement (>200 chars)');
      score += 1;
    }

    // Check 5: Vague/comprehensive terms
    const vagueTerms = ['full', 'complete', 'comprehensive', 'entire', 'whole', 'everything'];
    for (const term of vagueTerms) {
      if (lowerReq.includes(term)) {
        flags.push(`Vague term: "${term}"`);
        score += 2;
        break;
      }
    }

    // Check 6: Multiple screens/pages/components mentioned
    const uiTerms = ['page', 'screen', 'view', 'component', 'modal', 'form'];
    let uiTermCount = 0;
    for (const term of uiTerms) {
      const regex = new RegExp(`\\b${term}s?\\b`, 'gi');
      const matches = lowerReq.match(regex);
      if (matches) {
        uiTermCount += matches.length;
      }
    }
    if (uiTermCount >= 3) {
      flags.push('Multiple UI components mentioned');
      score += 3;
    } else if (uiTermCount >= 2) {
      flags.push('Multiple UI elements mentioned');
      score += 1;
    }

    // Check 7: Multiple feature areas (auth, database, API, etc.)
    const featureAreas = ['auth', 'database', 'api', 'ui', 'frontend', 'backend', 'testing', 'deploy'];
    let areasFound = 0;
    for (const area of featureAreas) {
      if (lowerReq.includes(area)) {
        areasFound++;
      }
    }
    if (areasFound >= 3) {
      flags.push('Spans multiple feature areas');
      score += 3;
    } else if (areasFound >= 2) {
      flags.push('Touches multiple areas');
      score += 1;
    }

    // Check 8: "with" chains (feature with feature with feature)
    const withCount = (lowerReq.match(/\bwith\b/g) ?? []).length;
    if (withCount >= 3) {
      flags.push('Multiple "with" chains');
      score += 2;
    }

    // Determine result based on score
    if (score >= 6) {
      return {
        needsDecomposition: true,
        confidence: 'high',
        flags,
      };
    } else if (score >= 3) {
      return {
        needsDecomposition: true,
        confidence: 'medium',
        flags,
      };
    } else if (score >= 1) {
      return {
        needsDecomposition: false,
        confidence: 'medium',
        flags,
      };
    } else {
      return {
        needsDecomposition: false,
        confidence: 'high',
        flags,
      };
    }
  }

  /**
   * Phase 2: Run AI analysis using the decomposer agent
   */
  private async runAIAnalysis(requirement: string): Promise<AnalysisResult> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session for AI analysis');
    }

    const invoker = new AgentInvoker(this.sessionManager);

    const task: Task = {
      id: nanoid(),
      sessionId: session.id,
      requirementId: null,
      agentType: 'decomposer',
      input: {
        mode: 'analyze',
        requirement,
      },
      output: null,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };

    const result = await invoker.invoke(task);

    if (!result.success) {
      throw new Error('AI analysis failed');
    }

    const output = result.output as {
      needsDecomposition?: boolean;
      reasoning?: string;
      suggestedSubRequirements?: string[];
    };

    const analysisResult: AnalysisResult = {
      needsDecomposition: output.needsDecomposition ?? false,
      confidence: 'high',
      reasoning: output.reasoning ?? 'AI analysis completed',
      heuristicFlags: [],
    };

    if (output.suggestedSubRequirements && output.suggestedSubRequirements.length > 0) {
      analysisResult.suggestedSubRequirements = output.suggestedSubRequirements;
    }

    return analysisResult;
  }

  /**
   * Build a human-readable reasoning from heuristic flags
   */
  private buildHeuristicReasoning(result: HeuristicResult): string {
    if (result.flags.length === 0) {
      return result.needsDecomposition
        ? 'Requirement appears to contain multiple distinct tasks'
        : 'Requirement appears focused and well-scoped';
    }

    const intro = result.needsDecomposition
      ? 'This requirement may be too broad because:'
      : 'This requirement appears well-scoped. Observations:';

    const flagList = result.flags.map((f) => `• ${f}`).join('\n');

    return `${intro}\n${flagList}`;
  }

  /**
   * Quick check if a requirement likely needs decomposition
   * (Uses only heuristics for speed)
   */
  quickCheck(requirement: string): boolean {
    const result = this.runHeuristics(requirement);
    return result.needsDecomposition && result.confidence !== 'low';
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createRequirementAnalyzer(sessionManager: SessionManager): RequirementAnalyzer {
  return new RequirementAnalyzer(sessionManager);
}
