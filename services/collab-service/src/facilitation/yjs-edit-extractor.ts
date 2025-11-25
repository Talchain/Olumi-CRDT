/**
 * Yjs Edit Extractor (K.1 Integration)
 *
 * Tracks Yjs updates for session health scoring.
 * Each update = 1 edit event (sufficient for velocity and activity metrics).
 */

import { EditRecord } from './session-metrics';

/**
 * Track Yjs update as edit event
 *
 * For session health, we care about:
 * - Edit velocity (updates/minute) ✓
 * - Unique editors (userId) ✓
 * - Concurrent updates (same board, multiple users) ✓
 *
 * Element-level tracking is optional - velocity is the key metric.
 */
export function trackUpdateAsEdit(
  boardId: string,
  userId: string,
  updateSize: number
): EditRecord {
  return {
    board_id: boardId,
    element_id: `collab-update-${Date.now()}`, // Unique per update
    user_id: userId,
    field: 'yjs-document',
    old_value: null,
    new_value: updateSize, // Update size as proxy for change magnitude
    is_undo: false, // Undo detection requires transaction metadata (future enhancement)
    timestamp: Date.now(),
  };
}
