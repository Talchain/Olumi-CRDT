/**
 * Collaboration bar showing connected users
 */

import React from 'react';
import { User, ConnectionStatus } from '../types';

interface CollaborationBarProps {
  users: User[];
  status: ConnectionStatus;
  className?: string;
}

export function CollaborationBar({ users, status, className = '' }: CollaborationBarProps) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 ${className}`}
    >
      {/* Connection status indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            status === ConnectionStatus.CONNECTED
              ? 'bg-green-500'
              : status === ConnectionStatus.CONNECTING || status === ConnectionStatus.RECONNECTING
              ? 'bg-yellow-500 animate-pulse'
              : 'bg-red-500'
          }`}
        />
        <span className="text-sm text-gray-600">
          {status === ConnectionStatus.CONNECTED
            ? 'Connected'
            : status === ConnectionStatus.CONNECTING
            ? 'Connecting...'
            : status === ConnectionStatus.RECONNECTING
            ? 'Reconnecting...'
            : status === ConnectionStatus.DISCONNECTED
            ? 'Offline'
            : 'Error'}
        </span>
      </div>

      {/* Divider */}
      {users.length > 0 && <div className="w-px h-6 bg-gray-300" />}

      {/* Connected users */}
      {users.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{users.length} editing:</span>
          <div className="flex -space-x-2">
            {users.slice(0, 5).map((user) => (
              <UserAvatar key={user.id} user={user} />
            ))}
            {users.length > 5 && (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 border-2 border-white text-xs font-medium text-gray-600">
                +{users.length - 5}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface UserAvatarProps {
  user: User;
  size?: 'sm' | 'md' | 'lg';
}

export function UserAvatar({ user, size = 'md' }: UserAvatarProps) {
  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
  };

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`${sizeClasses[size]} rounded-full border-2 border-white flex items-center justify-center font-medium text-white`}
      style={{ backgroundColor: user.color }}
      title={user.name}
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name} className="w-full h-full rounded-full" />
      ) : (
        initials
      )}
    </div>
  );
}
