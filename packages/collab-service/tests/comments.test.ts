/**
 * Comments System Tests
 *
 * Tests for comment management and evidence integration:
 * - Comment creation and lifecycle
 * - Threading and replies
 * - Evidence references
 * - Resolution workflows
 * - Authorization and permissions
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseClient } from '../src/database/client';
import { DocumentManager } from '../src/collab/document-manager';
import { BoardDocument } from '../src/types/board';

describe('Comments System', () => {
  let db: DatabaseClient;
  let documentManager: DocumentManager;

  beforeEach(async () => {
    db = new DatabaseClient();
    await db.initialize();
    documentManager = new DocumentManager(db);
  });

  afterEach(async () => {
    await documentManager.shutdown();
    await db.close();
  });

  describe('Comment Creation', () => {
    it('should create a comment on a goal', async () => {
      const boardId = 'board-comment-1';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'This goal needs more specificity.',
        }
      );

      expect(comment.id).toBeDefined();
      expect(comment.boardId).toBe(boardId);
      expect(comment.attachedTo.entityId).toBe('goal-1');
      expect(comment.attachedTo.type).toBe('goal');
      expect(comment.authorId).toBe('user-1');
      expect(comment.authorName).toBe('Alice');
      expect(comment.content).toBe('This goal needs more specificity.');
      expect(comment.resolved).toBe(false);
    });

    it('should create a comment with evidence references', async () => {
      const boardId = 'board-comment-2';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'assumption-1',
          entityType: 'assumption',
          content: 'This assumption is supported by recent data.',
          evidenceRefs: ['evidence-1', 'evidence-2'],
        }
      );

      expect(comment.evidenceRefs).toHaveLength(2);
      expect(comment.evidenceRefs).toContain('evidence-1');
      expect(comment.evidenceRefs).toContain('evidence-2');
    });

    it('should create a reply to another comment', async () => {
      const boardId = 'board-comment-3';
      const orgId = 'org-123';
      const teamId = 'team-456';

      // Create parent comment
      const parentComment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'What's the timeline for this?',
        }
      );

      // Create reply
      const reply = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-2',
        'Bob',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'We're targeting Q4 2025.',
          replyTo: parentComment.id,
        }
      );

      expect(reply.replyTo).toBe(parentComment.id);
      expect(reply.attachedTo.entityId).toBe('goal-1');
    });
  });

  describe('Comment Updates', () => {
    it('should update a comment by its author', async () => {
      const boardId = 'board-comment-4';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'Original content',
        }
      );

      const updatedComment = await documentManager.commentsManager.updateComment(
        comment.id,
        'user-1',
        {
          content: 'Updated content',
        }
      );

      expect(updatedComment).toBeDefined();
      expect(updatedComment?.content).toBe('Updated content');
    });

    it('should not allow updating comment by non-author', async () => {
      const boardId = 'board-comment-5';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'Original content',
        }
      );

      await expect(async () => {
        await documentManager.commentsManager.updateComment(comment.id, 'user-2', {
          content: 'Attempted update',
        });
      }).rejects.toThrow('Only comment author can update');
    });

    it('should update evidence references', async () => {
      const boardId = 'board-comment-6';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'outcome-1',
          entityType: 'outcome',
          content: 'This outcome is likely.',
          evidenceRefs: ['evidence-1'],
        }
      );

      const updatedComment = await documentManager.commentsManager.updateComment(
        comment.id,
        'user-1',
        {
          evidenceRefs: ['evidence-1', 'evidence-2', 'evidence-3'],
        }
      );

      expect(updatedComment?.evidenceRefs).toHaveLength(3);
      expect(updatedComment?.evidenceRefs).toContain('evidence-3');
    });
  });

  describe('Comment Deletion', () => {
    it('should soft delete a comment by its author', async () => {
      const boardId = 'board-comment-7';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'To be deleted',
        }
      );

      const deleted = await documentManager.commentsManager.deleteComment(comment.id, 'user-1');
      expect(deleted).toBe(true);

      // Verify comment is not returned in normal queries
      const comments = await documentManager.commentsManager.getComments(boardId);
      expect(comments).toHaveLength(0);

      // Verify comment is still in database (soft delete)
      const commentsWithDeleted = await documentManager.commentsManager.getComments(boardId, {
        includeDeleted: true,
      });
      expect(commentsWithDeleted).toHaveLength(1);
      expect(commentsWithDeleted[0].deleted).toBe(true);
    });

    it('should not allow deleting comment by non-author', async () => {
      const boardId = 'board-comment-8';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'Protected content',
        }
      );

      await expect(async () => {
        await documentManager.commentsManager.deleteComment(comment.id, 'user-2');
      }).rejects.toThrow('Only comment author can delete');
    });
  });

  describe('Comment Resolution', () => {
    it('should resolve a comment', async () => {
      const boardId = 'board-comment-9';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'This needs clarification.',
        }
      );

      const resolved = await documentManager.commentsManager.resolveComment(comment.id, 'user-2');

      expect(resolved).toBeDefined();
      expect(resolved?.resolved).toBe(true);
      expect(resolved?.resolvedBy).toBe('user-2');
      expect(resolved?.resolvedAt).toBeDefined();
    });

    it('should unresolve a comment', async () => {
      const boardId = 'board-comment-10';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'Question about timeline.',
        }
      );

      // Resolve
      await documentManager.commentsManager.resolveComment(comment.id, 'user-2');

      // Unresolve
      const unresolved = await documentManager.commentsManager.unresolveComment(
        comment.id,
        'user-1'
      );

      expect(unresolved).toBeDefined();
      expect(unresolved?.resolved).toBe(false);
      expect(unresolved?.resolvedBy).toBeUndefined();
      expect(unresolved?.resolvedAt).toBeUndefined();
    });
  });

  describe('Comment Retrieval', () => {
    it('should get all comments for a board', async () => {
      const boardId = 'board-comment-11';
      const orgId = 'org-123';
      const teamId = 'team-456';

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Comment 1',
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'goal-2',
        entityType: 'goal',
        content: 'Comment 2',
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'option-1',
        entityType: 'option',
        content: 'Comment 3',
      });

      const comments = await documentManager.commentsManager.getComments(boardId);

      expect(comments).toHaveLength(3);
    });

    it('should filter comments by entity', async () => {
      const boardId = 'board-comment-12';
      const orgId = 'org-123';
      const teamId = 'team-456';

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'On goal-1',
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Also on goal-1',
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-2',
        entityType: 'goal',
        content: 'On goal-2',
      });

      const commentsOnGoal1 = await documentManager.commentsManager.getComments(boardId, {
        entityId: 'goal-1',
      });

      expect(commentsOnGoal1).toHaveLength(2);
      expect(commentsOnGoal1.every((c) => c.attachedTo.entityId === 'goal-1')).toBe(true);
    });

    it('should filter comments by resolution status', async () => {
      const boardId = 'board-comment-13';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment1 = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'To be resolved',
        }
      );

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'goal-2',
        entityType: 'goal',
        content: 'Stays unresolved',
      });

      // Resolve first comment
      await documentManager.commentsManager.resolveComment(comment1.id, 'user-2');

      // Get unresolved comments
      const unresolvedComments = await documentManager.commentsManager.getComments(boardId, {
        resolved: false,
      });

      expect(unresolvedComments).toHaveLength(1);
      expect(unresolvedComments[0].content).toBe('Stays unresolved');

      // Get resolved comments
      const resolvedComments = await documentManager.commentsManager.getComments(boardId, {
        resolved: true,
      });

      expect(resolvedComments).toHaveLength(1);
      expect(resolvedComments[0].content).toBe('To be resolved');
    });
  });

  describe('Comment Threads', () => {
    it('should group comments into threads by entity', async () => {
      const boardId = 'board-comment-14';
      const orgId = 'org-123';
      const teamId = 'team-456';

      // Comments on goal-1
      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'First on goal-1',
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Second on goal-1',
      });

      // Comment on option-1
      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'option-1',
        entityType: 'option',
        content: 'On option-1',
      });

      const threads = await documentManager.commentsManager.getCommentThreads(boardId);

      expect(threads).toHaveLength(2);

      const goal1Thread = threads.find((t) => t.entityId === 'goal-1');
      expect(goal1Thread).toBeDefined();
      expect(goal1Thread?.comments).toHaveLength(2);
      expect(goal1Thread?.entityType).toBe('goal');

      const option1Thread = threads.find((t) => t.entityId === 'option-1');
      expect(option1Thread).toBeDefined();
      expect(option1Thread?.comments).toHaveLength(1);
      expect(option1Thread?.entityType).toBe('option');
    });

    it('should track unresolved count in threads', async () => {
      const boardId = 'board-comment-15';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment1 = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'Unresolved 1',
        }
      );

      const comment2 = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-2',
        'Bob',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'To be resolved',
        }
      );

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Unresolved 2',
      });

      // Resolve middle comment
      await documentManager.commentsManager.resolveComment(comment2.id, 'user-1');

      const threads = await documentManager.commentsManager.getCommentThreads(boardId);

      const goal1Thread = threads.find((t) => t.entityId === 'goal-1');
      expect(goal1Thread?.unresolvedCount).toBe(2); // Two unresolved comments
    });

    it('should sort comments by creation time within threads', async () => {
      const boardId = 'board-comment-16';
      const orgId = 'org-123';
      const teamId = 'team-456';

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'First',
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Second',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Third',
      });

      const threads = await documentManager.commentsManager.getCommentThreads(boardId);

      const goal1Thread = threads.find((t) => t.entityId === 'goal-1');
      expect(goal1Thread?.comments[0].content).toBe('First');
      expect(goal1Thread?.comments[1].content).toBe('Second');
      expect(goal1Thread?.comments[2].content).toBe('Third');
    });
  });

  describe('Comment Statistics', () => {
    it('should calculate comment statistics for a board', async () => {
      const boardId = 'board-comment-17';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const comment1 = await documentManager.commentsManager.createComment(
        boardId,
        orgId,
        teamId,
        'user-1',
        'Alice',
        {
          entityId: 'goal-1',
          entityType: 'goal',
          content: 'Goal comment',
        }
      );

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'option-1',
        entityType: 'option',
        content: 'Option comment',
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'outcome-1',
        entityType: 'outcome',
        content: 'Outcome comment',
      });

      // Resolve one comment
      await documentManager.commentsManager.resolveComment(comment1.id, 'user-2');

      const stats = await documentManager.commentsManager.getCommentStats(boardId);

      expect(stats.totalComments).toBe(3);
      expect(stats.unresolvedComments).toBe(2);
      expect(stats.commentsByType['goal']).toBe(1);
      expect(stats.commentsByType['option']).toBe(1);
      expect(stats.commentsByType['outcome']).toBe(1);
      expect(stats.recentActivity).toBeGreaterThanOrEqual(0); // Within last 24 hours
    });

    it('should track recent activity (last 24 hours)', async () => {
      const boardId = 'board-comment-18';
      const orgId = 'org-123';
      const teamId = 'team-456';

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'goal-1',
        entityType: 'goal',
        content: 'Recent comment',
      });

      const stats = await documentManager.commentsManager.getCommentStats(boardId);

      expect(stats.recentActivity).toBe(1); // Within last 24 hours
    });
  });

  describe('Evidence Integration', () => {
    it('should find comments referencing specific evidence', async () => {
      const boardId = 'board-comment-19';
      const orgId = 'org-123';
      const teamId = 'team-456';

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'assumption-1',
        entityType: 'assumption',
        content: 'Supported by evidence-1',
        evidenceRefs: ['evidence-1'],
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-2', 'Bob', {
        entityId: 'assumption-2',
        entityType: 'assumption',
        content: 'Supported by evidence-1 and evidence-2',
        evidenceRefs: ['evidence-1', 'evidence-2'],
      });

      await documentManager.commentsManager.createComment(boardId, orgId, teamId, 'user-1', 'Alice', {
        entityId: 'assumption-3',
        entityType: 'assumption',
        content: 'Supported by evidence-2 only',
        evidenceRefs: ['evidence-2'],
      });

      const commentsWithEvidence1 = await documentManager.commentsManager.getCommentsByEvidence(
        boardId,
        'evidence-1'
      );

      expect(commentsWithEvidence1).toHaveLength(2);
      expect(commentsWithEvidence1.every((c) => c.evidenceRefs.includes('evidence-1'))).toBe(true);
    });
  });
});
