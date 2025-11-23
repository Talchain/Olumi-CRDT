/**
 * Banner showing connection status and errors
 */

import React from 'react';
import { ConnectionStatus } from '../types';

interface ConnectionBannerProps {
  status: ConnectionStatus;
  errorMessage?: string;
  onDismiss?: () => void;
}

export function ConnectionBanner({ status, errorMessage, onDismiss }: ConnectionBannerProps) {
  // Only show banner for non-connected states
  if (status === ConnectionStatus.CONNECTED) {
    return null;
  }

  const getBannerStyle = () => {
    switch (status) {
      case ConnectionStatus.CONNECTING:
      case ConnectionStatus.RECONNECTING:
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case ConnectionStatus.ERROR:
      case ConnectionStatus.DISCONNECTED:
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getMessage = () => {
    switch (status) {
      case ConnectionStatus.CONNECTING:
        return 'Connecting to collaboration server...';
      case ConnectionStatus.RECONNECTING:
        return 'Connection lost. Reconnecting...';
      case ConnectionStatus.DISCONNECTED:
        return 'You are offline. Changes will sync when reconnected.';
      case ConnectionStatus.ERROR:
        return errorMessage || 'Connection error. Please refresh the page.';
      default:
        return 'Unknown status';
    }
  };

  return (
    <div className={`border-b px-4 py-3 ${getBannerStyle()}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(status === ConnectionStatus.CONNECTING || status === ConnectionStatus.RECONNECTING) && (
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
          <span className="text-sm font-medium">{getMessage()}</span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-current opacity-60 hover:opacity-100 transition-opacity"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
