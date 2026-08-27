# Vite Dev Server Performance Fix

## Status

Draft - impact review completed on 2026-08-14; corrections and Eric's approval are still required.

## Impact review - 2026-08-14

### Decision

Do not implement this draft unchanged. The watcher and compiler-scope changes are isolated from the
runtime packages, but parts of the diagnosis and validation procedure are inaccurate for the current
workspace.

### Verified current state

- The installed workspace versions are Vite 8.2.1, `@vitejs/plugin-react` 6.0.5,
  `@rolldown/plugin-babel` 0.2.3, and `@tailwindcss/vite` 4.3.3. The version sentence in the Problem
  section reflects earlier manifest ranges, not the current lockfile.
- `fsevents` 2.3.3 is installed through Vite. Chokidar uses FSEvents when it is available; polling on
  macOS is the fallback when FSEvents cannot be used. The draft must not state that Vite
  unconditionally polls on macOS.
- Two already-running dev servers for this repository were sampled five times while idle on
  2026-08-14. They reported 0-0.1% CPU, so the reported ~200% condition was not reproduced during
  this review. A before/after measurement under the condition that triggers the problem is required.
- Vite 8.2.1 already ignores `.git`, `node_modules`, `test-results`, `cacheDir`, and every emptied
  build `outDir`. Adding `node_modules` and root `dist` to `server.watch.ignored` is therefore
  defensive and mostly redundant, not a fix for a missing default.
- The installed React Compiler preset already has a code filter, but it still admits many pure files
  containing capitalized identifiers or hook-like names. Restricting Babel to actual JSX/TSX source
  remains a credible optimization.

### Impact on the avatar-runtime work

| Area                                       | Impact                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root Studio dev server                     | Direct. `server.watch` and the root Babel plugin change startup, idle watching, and HMR behavior.                                                                                                                    |
| `packages/avatar-core`                     | Source HMR must remain enabled through the root alias. Its own build config is unaffected. The Babel compiler can safely exclude this package because it contains no JSX.                                            |
| `packages/avatar-react`                    | Its library build config is unaffected. A generic `/src/...tsx/` regex also matches `packages/avatar-react/src/Avatar.tsx`, contrary to the draft's "app only" explanation; an app-root-anchored filter is required. |
| React consumer fixture                     | No direct impact because it owns a separate Vite config. Its HMR needs a separate smoke check only if that config is changed later.                                                                                  |
| Vitest, tarball smoke, production packages | No direct impact. Their processes/configs are separate, but the normal regression suite must still pass.                                                                                                             |
| Standalone engine generation               | No idle impact. `pnpm dev` runs `pnpm engine` once before Vite, so startup CPU must be measured separately from steady-state Vite CPU.                                                                               |

### Required corrections before approval

1. Reword cause 1 as a hypothesis about an FSEvents fallback and capture evidence that the affected
   process is actually polling.
2. Reword cause 2 to acknowledge Vite's existing ignore defaults. Add only project-specific paths if
   measurements show that they are watched.
3. Anchor the Babel include filter to the absolute root `src/` directory. The proposed
   `/src\/.*\.[jt]sx$/` expression is not root-specific.
4. Record both manifest ranges and installed lockfile versions, and repeat measurements after any
   dependency install.
5. Start a single strict-port dev server for measurement and resolve its exact PID. `pgrep -f vite`
   is ambiguous on this machine because several unrelated Vite servers run concurrently.
6. Measure startup separately from at least 30 seconds of idle CPU, an HMR edit under root `src/`,
   and an HMR edit under `packages/avatar-core/src/`.
7. Treat the Vite 7 downgrade as a separate decision that modifies `package.json` and
   `pnpm-lock.yaml`; this contradicts the current "vite.config.ts only" file list.
8. Re-evaluate the cited Vite 8/Rolldown memory reports against Vite 8.2.1 and the installed Rolldown
   version before using an 800 MB downgrade threshold.

## Problem

The dev server (`pnpm dev`) consumes ~200% CPU on macOS. The project runs Vite 8.0.13 with
`@vitejs/plugin-react` 6.0.2, `@rolldown/plugin-babel` (React Compiler preset),
`@tailwindcss/vite` 4.3.3, and a pnpm workspace monorepo (`packages/avatar-core` linked via
`workspace:*`).

Four documented causes have been identified, ordered by expected impact.

## Root causes

### 1. File watcher defaults to polling on macOS

Vite inherits a legacy default that sets `usePolling: true` on macOS. Instead of using the
kernel's native `FSEvents`, chokidar scans every watched file on a timer. In a monorepo with
`node_modules` symlinks this produces sustained CPU even when no file changes.

**Source**: https://github.com/vitejs/vite/issues/21033

### 2. Watcher scope includes node_modules and dist

No `server.watch.ignored` is configured. The workspace alias
`@bible-strong/avatar-core → packages/avatar-core/src/index.ts` causes the watcher to follow
pnpm symlinks into `node_modules/.pnpm`, multiplying the number of watched paths.

### 3. React Compiler runs on all files

`@rolldown/plugin-babel` with `reactCompilerPreset()` is applied globally. It processes every
`.ts`/`.tsx` file including `packages/avatar-core`, which contains zero React components — pure
geometry, math, and schema validation. The compiler's analysis pass is expensive and wasted on
non-component code.

**Source**: https://github.com/vitejs/vite-plugin-react/discussions/1148

### 4. Vite 8 (Rolldown) baseline memory regression

Vite 8's Rolldown bundler uses ~1.1 GB within 37 seconds vs ~300 MB for Vite 5. Higher memory
pressure triggers frequent GC cycles that manifest as CPU usage.

**Sources**:

- https://github.com/vitejs/rolldown-vite/issues/577
- https://github.com/rolldown/rolldown/issues/9330

## Changes

All changes are in `/vite.config.ts` (root). No other files are modified.

### Change 1 — Disable polling and scope the watcher

Add a `server` block to the Vite config:

```ts
server: {
  watch: {
    usePolling: false,
    ignored: ['**/node_modules/**', '**/dist/**'],
  },
},
```

**Why `usePolling: false`**: macOS FSEvents is reliable and near-zero CPU. The polling
fallback exists for network filesystems (NFS/SMB) which do not apply here.

**Why `ignored`**: prevents chokidar from traversing pnpm's `.pnpm` store and build output
directories. These paths never contain source files that need HMR.

### Change 2 — Scope the Babel React Compiler to app source only

Current config (line 14):

```ts
plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
```

Add an `include` filter to the `babel()` call:

```ts
plugins: [
  react(),
  babel({
    presets: [reactCompilerPreset()],
    include: [/src\/.*\.[jt]sx$/],
  }),
  tailwindcss(),
],
```

The pattern `src\/.*\.[jt]sx$` matches only `.jsx`/`.tsx` files under `src/` (the app).
It excludes:

- `packages/avatar-core/` (no React components)
- `.ts` files that are pure logic (no JSX to compile)

### Change 3 — Monitor and consider Vite downgrade (conditional)

If changes 1–2 do not bring CPU below ~30% idle:

1. Run `pnpm dev` and note RSS memory after 60 seconds (`ps -o rss -p $(pgrep -f vite)`).
2. If RSS exceeds 800 MB, the Rolldown memory regression is contributing. Consider pinning
   Vite 7 (`"vite": "^7.0.0"`) until Rolldown stabilises. This requires:
   - Replacing `@rolldown/plugin-babel` with standard `@vitejs/plugin-react` Babel config
     (v5 style), since `@rolldown/plugin-babel` is Vite 8–specific.
   - Verifying the Tailwind v4 plugin remains compatible with Vite 7.

This step is **not** part of the default changeset — only pursue it if the first two changes
are insufficient.

## Validation

After applying changes 1–2:

1. `pnpm dev` — verify the server starts and HMR works (edit a `.tsx` in `src/`, confirm
   hot reload).
2. Monitor CPU for 30 seconds idle: `top -pid $(pgrep -f vite) -l 5`. Expect < 10% idle CPU
   (down from ~200%).
3. Edit a file in `packages/avatar-core/src/` — verify HMR still picks up the change despite
   the watcher `ignored` pattern (the alias resolves to source, which is under the project
   root and not under `node_modules`).
4. `pnpm build` — verify production build still succeeds (the `server` block does not affect
   build).
5. `pnpm test` — verify no test regressions.

## Files modified

| File             | Nature of change                                                    |
| ---------------- | ------------------------------------------------------------------- |
| `vite.config.ts` | Add `server.watch` config, add `include` filter to `babel()` plugin |

## Out of scope

- Upgrading or downgrading Vite (unless change 3 is triggered).
- Modifying `packages/avatar-core/vite.config.ts` (library build config, not the dev server).
- Changing `vitest.config.ts` (test runner, separate process).
- Tailwind v4 plugin tuning (4.3.3 has no known performance issues per
  https://github.com/tailwindlabs/tailwindcss/issues/16911, fixed since 4.0.10).
