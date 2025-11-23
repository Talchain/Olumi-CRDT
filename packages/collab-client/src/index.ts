/**
 * Olumi Collaboration Client
 * React library for real-time collaborative editing
 */

// Provider
export { CollaborationProvider } from './provider';

// Hooks
export {
  useCollaboration,
  useBoardState,
  useBoardActions,
  usePresence,
  useConnectedUsers,
  useUndoRedo,
} from './hooks';

// Components
export { CollaborationBar, UserAvatar } from './components/CollaborationBar';
export { ConnectionBanner } from './components/ConnectionBanner';
export { SelectionIndicator } from './components/SelectionIndicator';

// Types
export * from './types';
