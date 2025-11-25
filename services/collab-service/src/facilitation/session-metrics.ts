/**
 * Session Metrics Collection (K.1)
 *
 * Tracks edit activity in a sliding 5-minute window for health scoring.
 * Simple arithmetic - no ML required.
 */

export interface EditRecord {
  board_id: string;
  element_id: string;
  user_id: string;
  field: string;
  old_value: any;
  new_value: any;
  is_undo: boolean;
  timestamp: number;
}

export interface ElementStats {
  edit_count: number;
  unique_editors: Set<string>;
  value_changes: number[];
}

export interface SessionMetrics {
  board_id: string;
  window_start: Date;
  window_end: Date;

  // Simple counts
  edit_count: number;
  unique_editor_count: number;
  undo_count: number;

  // Derived (simple math)
  edits_per_minute: number;
  reversion_rate: number; // undo_count / edit_count

  // Per-element tracking
  element_edit_counts: Map<string, ElementStats>;
}

/**
 * Collects edit metrics in a sliding window
 */
export class MetricsCollector {
  private edits: EditRecord[] = [];
  private readonly WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Record an edit event
   */
  recordEdit(edit: {
    board_id: string;
    element_id: string;
    user_id: string;
    field: string;
    old_value: any;
    new_value: any;
    is_undo: boolean;
  }): void {
    this.edits.push({
      ...edit,
      timestamp: Date.now(),
    });

    // Trim old edits outside the window
    const cutoff = Date.now() - this.WINDOW_MS;
    this.edits = this.edits.filter((e) => e.timestamp > cutoff);
  }

  /**
   * Get metrics for a board
   */
  getMetrics(boardId: string): SessionMetrics {
    const boardEdits = this.edits.filter((e) => e.board_id === boardId);

    if (boardEdits.length === 0) {
      return this.emptyMetrics(boardId);
    }

    const oldestEdit = boardEdits[0]?.timestamp || Date.now();
    const windowMs = Math.min(this.WINDOW_MS, Date.now() - oldestEdit);

    // Calculate basic counts
    const uniqueEditors = new Set(boardEdits.map((e) => e.user_id));
    const undoCount = boardEdits.filter((e) => e.is_undo).length;

    // Group by element
    const elementStats = new Map<string, ElementStats>();
    for (const edit of boardEdits) {
      if (!elementStats.has(edit.element_id)) {
        elementStats.set(edit.element_id, {
          edit_count: 0,
          unique_editors: new Set(),
          value_changes: [],
        });
      }

      const stats = elementStats.get(edit.element_id)!;
      stats.edit_count++;
      stats.unique_editors.add(edit.user_id);

      // Track numeric value changes for variance
      if (typeof edit.new_value === 'number') {
        stats.value_changes.push(edit.new_value);
      }
    }

    return {
      board_id: boardId,
      window_start: new Date(Date.now() - windowMs),
      window_end: new Date(),
      edit_count: boardEdits.length,
      unique_editor_count: uniqueEditors.size,
      undo_count: undoCount,
      edits_per_minute: windowMs > 0 ? boardEdits.length / (windowMs / 60000) : 0,
      reversion_rate: boardEdits.length > 0 ? undoCount / boardEdits.length : 0,
      element_edit_counts: elementStats,
    };
  }

  /**
   * Get all active boards (boards with recent edits)
   */
  getActiveBoards(): string[] {
    const boards = new Set<string>();
    for (const edit of this.edits) {
      boards.add(edit.board_id);
    }
    return Array.from(boards);
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.edits = [];
  }

  /**
   * Get total edit count (for stats)
   */
  getTotalEdits(): number {
    return this.edits.length;
  }

  /**
   * Empty metrics for boards with no activity
   */
  private emptyMetrics(boardId: string): SessionMetrics {
    return {
      board_id: boardId,
      window_start: new Date(),
      window_end: new Date(),
      edit_count: 0,
      unique_editor_count: 0,
      undo_count: 0,
      edits_per_minute: 0,
      reversion_rate: 0,
      element_edit_counts: new Map(),
    };
  }
}
