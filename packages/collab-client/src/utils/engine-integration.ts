/**
 * Utilities for engine integration
 */

import { BoardState } from '../types';

export interface BoardRunInput {
  boardId: string;
  snapshotVersion?: number;
  goals: Array<{
    id: string;
    content: string;
    priority?: string;
  }>;
  options: Array<{
    id: string;
    content: string;
    description?: string;
  }>;
  outcomes: Array<{
    id: string;
    content: string;
    probability?: number;
    impact?: number;
    linkedOptionIds: string[];
  }>;
  assumptions: Array<{
    id: string;
    content: string;
    confidence?: string;
    linkedEntityIds: string[];
  }>;
  evidence: Array<{
    id: string;
    content: string;
    source?: string;
    credibility?: number;
    linkedAssumptionIds: string[];
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    weight?: number;
  }>;
}

/**
 * Transform board state to engine input format
 */
export function transformToRunInput(board: BoardState): BoardRunInput {
  return {
    boardId: board.id,
    snapshotVersion: board.version,
    goals: board.goals.map((g) => ({
      id: g.id,
      content: g.content,
      priority: g.priority,
    })),
    options: board.options.map((o) => ({
      id: o.id,
      content: o.content,
      description: o.description,
    })),
    outcomes: board.outcomes.map((o) => ({
      id: o.id,
      content: o.content,
      probability: o.probability,
      impact: o.impact,
      linkedOptionIds: o.linkedOptionIds,
    })),
    assumptions: board.assumptions.map((a) => ({
      id: a.id,
      content: a.content,
      confidence: a.confidence,
      linkedEntityIds: a.linkedEntityIds,
    })),
    evidence: board.evidence.map((e) => ({
      id: e.id,
      content: e.content,
      source: e.source,
      credibility: e.credibility,
      linkedAssumptionIds: e.linkedAssumptionIds,
    })),
    edges: board.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight,
    })),
  };
}

/**
 * Client for engine API
 */
export class EngineClient {
  private apiUrl: string;
  private authToken: string;

  constructor(apiUrl: string, authToken: string) {
    this.apiUrl = apiUrl;
    this.authToken = authToken;
  }

  /**
   * Run engine analysis on a board
   */
  async runAnalysis(boardId: string, config?: any): Promise<any> {
    // First, request a snapshot
    const snapshotResponse = await fetch(
      `${this.apiUrl}/api/collab/boards/${boardId}/run-input`,
      {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
        },
      }
    );

    if (!snapshotResponse.ok) {
      throw new Error('Failed to get board snapshot');
    }

    const snapshotData = await snapshotResponse.json();
    const { snapshotId, input } = snapshotData.data;

    // Call engine with snapshot
    const engineResponse = await fetch(`${this.apiUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({
        input,
        config,
        context: {
          snapshotId,
          boardId,
        },
      }),
    });

    if (!engineResponse.ok) {
      throw new Error('Engine run failed');
    }

    return engineResponse.json();
  }

  /**
   * Get run status
   */
  async getRunStatus(runId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v1/status/${runId}`, {
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get run status');
    }

    return response.json();
  }

  /**
   * Poll for run completion
   */
  async waitForCompletion(runId: string, timeout = 60000): Promise<any> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getRunStatus(runId);

      if (status.status === 'completed') {
        return status.result;
      } else if (status.status === 'failed') {
        throw new Error('Run failed: ' + status.error);
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Run timeout');
  }
}
