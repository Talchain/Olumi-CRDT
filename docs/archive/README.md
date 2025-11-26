# Archived Documentation

This directory contains legacy documentation that has been superseded by the consolidated documentation structure.

## Current Documentation (Use These)

The project now uses a streamlined 3-document structure:

1. **[/README.md](../../README.md)** - Quick start and overview
2. **[/TECHNICAL-SPECIFICATION.md](../../TECHNICAL-SPECIFICATION.md)** - Complete technical reference
3. **[/DEVELOPER-GUIDE.md](../../DEVELOPER-GUIDE.md)** - Development workflows

## Archived Files

| File/Directory | Archived Date | Reason | Replaced By |
|----------------|---------------|--------|-------------|
| `collab/` | 2025-11-25 | Outdated Phase 1-2 docs | TECHNICAL-SPECIFICATION.md |
| `SUMMARY.md` | 2025-11-25 | Outdated Phase 1-2 summary | README.md + TECHNICAL-SPECIFICATION.md |
| `COLLABORATION-FEATURES-SUMMARY.md` | 2025-11-25 | Became TECHNICAL-SPECIFICATION.md | TECHNICAL-SPECIFICATION.md |
| `SECURITY-HARDENING-SUMMARY.md` | 2025-11-25 | Merged into tech spec | TECHNICAL-SPECIFICATION.md (Security section) |

### Legacy Contents

**`collab/`** - Phase 1-2 CRDT collaboration documentation:
- `architecture.md` - Original CRDT architecture
- `api-contracts.md` - WebSocket/REST API specs
- `board-contracts.md` - Data structures
- `getting-started.md` - Old setup guide
- `deployment.md` - Phase 1-2 deployment
- `phase2-*.md` - Phase 2 planning docs
- Other feature-specific docs

**`SUMMARY.md`** - Phase 1-2 implementation summary (dated 2025-11-22)

**`COLLABORATION-FEATURES-SUMMARY.md`** - Comprehensive feature summary that became the base for TECHNICAL-SPECIFICATION.md

**`SECURITY-HARDENING-SUMMARY.md`** - Security implementation details (now in TECHNICAL-SPECIFICATION.md)

## Why Archived?

These documents were archived during the documentation consolidation effort (2025-11-25) for the following reasons:

1. **Outdated**: Phase 1-2 docs didn't include G.1-G.5, I.1-I.2, K.1-K.2 features
2. **Fragmented**: 15+ scattered files across multiple directories
3. **Duplicated**: Same information in multiple places
4. **Hard to maintain**: Too many files to keep synchronized
5. **Poor discoverability**: No clear entry point for new developers

## Using Archived Docs

**If you need historical context:**
- These docs are preserved for reference only
- Do NOT use for current development
- Refer to the current documentation structure

**If you find outdated information:**
- Open an issue or PR to update the current docs
- Do NOT update archived docs

---

**Archive Date**: 2025-11-25
**Consolidation Commit**: `acbe35b` - docs: Consolidate and modernize documentation structure
