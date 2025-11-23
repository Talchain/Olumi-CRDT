/**
 * Visual indicator for remote user selections
 */

import React from 'react';
import { PresenceState } from '../types';

interface SelectionIndicatorProps {
  entityId: string;
  presence: Map<number, PresenceState>;
  currentClientId: number;
}

export function SelectionIndicator({
  entityId,
  presence,
  currentClientId,
}: SelectionIndicatorProps) {
  // Find users selecting this entity
  const selectingUsers = Array.from(presence.entries())
    .filter(
      ([clientId, state]) =>
        clientId !== currentClientId && state.selection?.entityIds.includes(entityId)
    )
    .map(([, state]) => state.user);

  if (selectingUsers.length === 0) {
    return null;
  }

  // Show primary user (most recent)
  const primaryUser = selectingUsers[0];

  return (
    <div
      className="absolute inset-0 pointer-events-none border-2 rounded"
      style={{
        borderColor: primaryUser.color,
        boxShadow: `0 0 0 1px ${primaryUser.color}`,
      }}
    >
      {/* User label */}
      <div
        className="absolute -top-6 left-0 px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap"
        style={{ backgroundColor: primaryUser.color }}
      >
        {primaryUser.name}
        {selectingUsers.length > 1 && ` +${selectingUsers.length - 1}`}
      </div>
    </div>
  );
}
