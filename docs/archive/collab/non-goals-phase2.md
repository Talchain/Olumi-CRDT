# Phase 2 Non-Goals

**Purpose**: Explicitly document what is intentionally out of scope for Phase 2
**Date**: 2025-11-23

---

## Overview

This document clarifies features and capabilities that are **explicitly deferred** to future phases. These are not oversights—they are conscious decisions to maintain focus and deliver Phase 2 scope on time.

---

## 1. Semantic Conflict Detection

### What This Is
- Detecting when collaborators make "semantically conflicting" edits
- Example: User A sets probability to 0.9, User B simultaneously sets it to 0.1
- Flagging these as potential disagreements or conflicts requiring resolution

### Why Deferred
- CRDT handles technical conflicts (both updates merge)
- Semantic conflicts require domain-specific rules and thresholds
- Complex UI required for conflict resolution workflows
- Decision: Let CRDT merge, rely on presence awareness to prevent conflicts

### Future Phase
**Phase 3: "Advanced Collaboration Workflows"**
- Conflict detection rules (e.g., probability changes > 0.5 delta)
- Conflict resolution UI (accept/reject/merge)
- Semantic merge strategies beyond CRDT

---

## 2. Group Undo / Collaborative Undo

### What This Is
- Undo that affects all users' views simultaneously
- "Undo last group action" vs individual undo
- Confirmation flows for multi-user operations

### Why Deferred
- Complex semantics: Whose undo wins?
- Requires consensus mechanism or admin override
- Local undo (Yjs) is sufficient for Phase 2
- Risk of confusion if poorly implemented

### Future Phase
**Phase 3: "Facilitation Mode"**
- Workshop facilitator can undo group actions
- Confirmation dialogs for destructive multi-user ops
- Group undo history separate from individual history

---

## 3. Workshop and Facilitation Modes

### What This Is
- Special mode for guided workshops with facilitator controls
- Facilitator can:
  - Lock/unlock editing for participants
  - Control who can edit what (fine-grained permissions)
  - Guide participants through structured decision workflows
  - Manage voting/consensus mechanisms

### Why Deferred
- Phase 2 focuses on free-form collaboration
- Facilitation requires complex state management (locked states, voting)
- UI for facilitator controls is a major effort
- Decision: Start with equal-access collaboration, add facilitation later

### Future Phase
**Phase 3: "Facilitation & Workshop Mode"**
- Facilitator role with special permissions
- Lock/unlock controls
- Guided workflows (e.g., "brainstorm → vote → decide")
- Real-time voting/consensus mechanisms

---

## 4. Offline-First Behavior

### What This Is
- Full offline editing with local-first architecture
- Offline PLoT/ISL runs (local engine execution)
- Complex conflict resolution after prolonged disconnection
- IndexedDB or local storage for offline persistence

### Why Deferred
- Phase 2 assumes reliable connectivity (WebSocket)
- Offline-first adds significant complexity (sync protocols, storage)
- Engine runs require server-side infrastructure (not feasible offline)
- Decision: Handle short disconnections (reconnect), defer long-term offline

### Future Phase
**Phase 4: "Offline Support"**
- Local-first architecture with sync when online
- Offline board editing with eventual sync
- Local runs (if engine can be bundled/WASM)
- Conflict resolution for prolonged offline periods

---

## 5. Deep CEE Integration

### What This Is
- AI-powered collaboration where CEE (AI assistant) is a "participant"
- CEE suggestions appear as structured board artifacts (not just text)
- Real-time AI collaboration (AI adds goals/options as users work)
- AI-mediated conflict resolution

### Why Deferred
- CEE integration is a separate major initiative
- Phase 2 focuses on human-to-human collaboration
- AI collaboration UX is experimental, not production-ready
- Decision: Establish human collaboration first, add AI later

### Future Phase
**Phase 5: "AI Collaboration"**
- CEE as a virtual board participant
- AI-generated suggestions as structured entities
- AI-mediated facilitation (conflict detection, suggestion merging)
- Real-time AI assistance during workshops

---

## 6. Complexity Coaching / Guardrails

### What This Is
- Warnings about too many simultaneous editors (e.g., "10+ people editing")
- Alerts for large boards (performance degradation)
- Suggestions to split boards or reduce complexity
- "You have 50+ goals; consider organizing into sub-boards"

### Why Deferred
- Phase 2 establishes baseline collaboration (no UX guardrails yet)
- Complexity thresholds unknown (need real-world usage data)
- Risk of false positives annoying users
- Decision: Monitor performance in Phase 2, add guardrails in Phase 3

### Future Phase
**Phase 6: "UX Enhancements"**
- Complexity warnings based on real usage data
- Performance-based suggestions (e.g., "too many active editors")
- Board organization recommendations

---

## 7. Fine-Grained Permissions

### What This Is
- Per-entity permissions (e.g., "User A can edit goals, not options")
- Time-based permissions (e.g., "Editor role expires in 1 week")
- Conditional permissions (e.g., "Can edit only their own goals")

### Why Deferred
- Phase 2 has team-level RBAC (VIEWER, EDITOR, ADMIN, OWNER)
- Fine-grained permissions add significant complexity
- Most use cases covered by team-level roles
- Decision: Start simple (team roles), add granularity if needed

### Future Phase
**Phase 3: "Advanced Permissions"**
- Entity-level permissions (per-goal, per-option access)
- Time-based role expiration
- Conditional permissions (based on authorship, etc.)

---

## 8. Real-Time Notifications / Activity Feed

### What This Is
- "User X just added a goal"
- "User Y updated probability from 0.5 to 0.9"
- Activity feed showing all recent board changes
- Push notifications for critical events

### Why Deferred
- Phase 2 has presence awareness (who's online, where their cursor is)
- Notifications require additional infrastructure (push server, preferences)
- Activity feed adds UI complexity
- Decision: Presence is sufficient for Phase 2, defer detailed notifications

### Future Phase
**Phase 3: "Notifications & Activity"**
- Real-time activity feed
- Configurable push notifications
- "Mention" functionality (@user to notify)

---

## 9. Version History / Time Travel

### What This Is
- Browse board history at any point in time
- "Show me what the board looked like yesterday"
- Diff view between any two points in history
- Restore to arbitrary historical state

### Why Deferred
- Phase 2 has snapshot lineage (parent-child chain)
- Full time-travel requires storing all intermediate states (storage cost)
- Complex UI for timeline navigation
- Decision: Snapshot-based versioning sufficient for Phase 2

### Future Phase
**Phase 4: "Enhanced Versioning"**
- Full time-travel UI (slider to navigate history)
- Diff view between arbitrary timestamps
- Restore from any historical state
- Granular history (per-entity timeline)

---

## 10. Cross-Board References / Dependencies

### What This Is
- Link goals/options across multiple boards
- "This decision depends on outcome from Board B"
- Cross-board consistency checks
- Multi-board decision graphs

### Why Deferred
- Phase 2 focuses on single-board collaboration
- Cross-board references add significant complexity (lifecycle, permissions)
- Most use cases work within a single board
- Decision: Defer to future multi-board features

### Future Phase
**Phase 5: "Multi-Board Workflows"**
- Cross-board entity references
- Dependency tracking across boards
- Multi-board decision pipelines

---

## 11. Third-Party Integrations

### What This Is
- Export to Miro, Figma, Notion, etc.
- Import from spreadsheets, Trello, Asana
- Webhooks for external systems
- API for programmatic board manipulation

### Why Deferred
- Phase 2 establishes core collaboration (internal use)
- Integrations require API stability and documentation
- Each integration is significant effort
- Decision: Focus on internal users first, add integrations later

### Future Phase
**Phase 6: "Integrations & API"**
- Public API for board manipulation
- Export to common formats (JSON, CSV, etc.)
- Import from external tools
- Webhooks for event subscriptions

---

## 12. Mobile Optimizations

### What This Is
- Touch-optimized UI for tablets/phones
- Mobile-specific gestures (pinch-to-zoom, swipe)
- Offline-first for mobile (handle poor connectivity)
- Mobile app (native or PWA)

### Why Deferred
- Phase 2 targets desktop web (Chrome, Safari)
- Mobile collaboration UX requires significant redesign
- Most decision-making happens on desktop
- Decision: Desktop-first, mobile later

### Future Phase
**Phase 7: "Mobile Support"**
- Tablet-optimized UI
- Mobile web responsiveness
- Touch gestures for board manipulation
- Progressive Web App (PWA) for mobile

---

## 13. Advanced Analytics / Insights

### What This Is
- "How many editors typically collaborate on a board?"
- "Average time from board creation to first run"
- "Most active users/teams"
- AI-generated insights ("This decision seems rushed; only 1 editor")

### Why Deferred
- Phase 2 has basic metrics (connections, updates)
- Analytics require data collection infrastructure
- Insights require historical data (not available yet)
- Decision: Establish usage first, add analytics later

### Future Phase
**Phase 6: "Analytics & Insights"**
- Usage dashboards (admin)
- Collaboration patterns analysis
- AI-driven insights (based on edit patterns)

---

## 14. Custom Themes / Branding

### What This Is
- Organization-level custom themes (colors, logos)
- White-labeling for enterprise customers
- Per-team branding

### Why Deferred
- Phase 2 uses default Olumi branding
- Theming adds UI complexity
- Most customers OK with standard branding initially
- Decision: Standardize UI first, add customization later

### Future Phase
**Phase 7: "Enterprise Customization"**
- Org-level themes
- White-labeling options
- Custom logos and colors

---

## 15. Real-Time Video / Voice

### What This Is
- Integrated video conferencing
- Voice chat during collaboration
- Screen sharing within the app

### Why Deferred
- Phase 2 assumes users have external communication tools (Zoom, Teams)
- Video infrastructure is complex and expensive
- Most users prefer separate video tools
- Decision: Focus on board collaboration, not video

### Future Phase
**Phase 8: "Integrated Communication"** (if ever)
- Optional: Embedded video/voice
- Or: Deep integration with Zoom/Teams APIs

---

## Rationale for Deferrals

### Focus
Phase 2 goal: **Enterprise-grade collaboration with security, provenance, and robustness**.
- Defer features that don't directly support this goal

### Complexity
- Each deferred feature adds weeks/months of effort
- Risk of scope creep delaying core value

### Data-Driven
- Need real-world usage data to design features well
- Example: Complexity coaching requires knowing actual complexity thresholds

### User Feedback
- Ship Phase 2, get feedback, prioritize Phase 3 based on actual needs
- Avoid building features users don't want

---

## How to Use This Document

### For Product Team
- Reference when users request features
- "That's Phase 3; here's why"
- Manage expectations

### For Engineering
- Resist scope creep
- "Non-goal for Phase 2" is a valid reason to defer

### For Stakeholders
- Understand what Phase 2 delivers (and doesn't)
- Plan future phases based on priorities

---

## Phase 2 Focus (Reminder)

### ✅ What Phase 2 DOES Deliver

1. **Deterministic Snapshots** - Exact state identification
2. **Multi-tenant Security** - Org → Team → Board hierarchy, RBAC
3. **CRDT Robustness** - Proven reliability under messy conditions
4. **Audit Provenance** - Decision review and compliance
5. **ISL Validation** - Prevent invalid models (pending coordination)
6. **Snapshot Management** - Lineage, restore, provenance
7. **Performance** - Production-grade observability

### ❌ What Phase 2 Does NOT Deliver

Everything listed in this document. Explicitly out of scope.

---

**Bottom Line**: Phase 2 establishes a **solid, secure, production-ready collaboration foundation**. Advanced features come later, informed by real usage.
