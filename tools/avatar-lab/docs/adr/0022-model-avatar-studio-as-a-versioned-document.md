# ADR-0022: Model Avatar Studio as a versioned document

## Status

Accepted

## Context

Avatar Studio previously persisted Avatars, Expressions, Animations, and Playback separately. Animation
steps referenced Expressions by their current array position, so inserting or deleting an
Expression required coordinated remapping and could leave partially persisted data.

## Decision

Avatar Studio persists one versioned Studio document. Every Expression has a durable identity and
State steps reference that identity. Existing local data is migrated automatically by resolving
legacy expression indexes against the migrated Expression catalog. An Avatar owns its Neutral
appearance; global Expressions describe relative changes, and optional Expression colors remain
temporary overrides. Playback exclusively owns the animated Pose until a direct user manipulation
pauses it. Changing Avatar preserves the current Playback position.

## Consequences

Studio mutations preserve cross-object invariants in one transaction. Reordering Expressions no
longer changes Animation meaning. The project is pre-release and the bundled version-2 document is
the current baseline; no compatibility migration for earlier prototypes is maintained.
