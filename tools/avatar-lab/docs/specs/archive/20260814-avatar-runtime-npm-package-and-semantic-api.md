# Avatar Runtime NPM Package and Semantic API

## Status

Complete and archived on 2026-08-14. React v1 phases A-E are implemented and verified. The packages
remain private and must not be published until licensing and repository metadata are approved.
Product decisions 1 to 21 were recorded on 2026-08-14.

### Implementation progress - 2026-08-14

| Phase                                                    | State    | Evidence                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A - Contract and pure conversion                         | Complete | The v1 JSON Schema, bounded duplicate-detecting parser, Ajv validation, public types, Studio conversion and focused boundary tests are implemented.                                                                                                                                                       |
| B - Semantic Studio authoring                            | Complete | The approved bundled catalog has semantic keys. The Studio validates keys, reports export readiness, downloads `.avatar.json`, copies formatted JSON accessibly, and keeps English, French and Simplified Chinese copy synchronized.                                                                      |
| C - Extract core package                                 | Complete | `@bible-strong/avatar-core` contains the framework-independent contract, geometry, scene generation, semantic lookup and deterministic playback. ESM, declarations and documented entry points build successfully.                                                                                        |
| D - React renderer package                               | Complete | `@bible-strong/avatar-react` implements React 19 refs, embedded/floating SVG, SSR portal handoff, controlled/uncontrolled playback, direct per-frame rendering, pointer/keyboard movement, bounds, resize behavior and accessible movement controls.                                                      |
| E - Existing export integration and package verification | Complete | Both packages build and pack. The smoke script installs their actual tarballs in a clean non-workspace React/Vite consumer, typechecks and builds it. Browser checks covered semantic controls, embedded/floating rendering, drag, reduced motion, mobile overflow, console errors and network responses. |
| F - Additional framework adapters                        | Deferred | Vue and Angular remain explicitly outside the React v1 scope and require a separate go-ahead.                                                                                                                                                                                                             |

### Archive state

Implementation was completed on branch `avatar-runtime`. Do not publish either package and do not
start Vue or Angular adapters without a separate product decision.

#### Runtime export bug reported on 2026-08-14

The Studio displayed one missing-key error for every bundled Expression and Animation, followed by
many secondary unresolved-reference errors. This made the active Strobi avatar appear impossible to
export.

The fix is implemented:

- when the known bundled catalog is loaded without semantic keys, its approved keys are restored by
  durable internal ID;
- custom Expressions and Animations are never assigned invented keys;
- unresolved-reference consequences are hidden when an Expression key error already explains the
  problem, and identical messages are deduplicated;
- the incomplete-export card offers a destructive `Clear local project and reload` action that
  removes only the Studio document storage key before loading the bundled catalog again;
- the same repair applies to base behavior and Avatar-owned behavior;
- focused persistence tests cover the repaired bundled catalog and prove that a custom item remains
  unkeyed.

The Export accordion flags `Export runtime JSON` as new and distinguishes it from the pre-existing
`Export avatar` ZIP generator. The former exports runtime data for the npm packages; the latter
continues to generate the historical standalone React or JavaScript ZIP.
The runtime section also includes a compact `<pre>` quick start with the npm install command and a
minimal validated React integration. It explicitly notes that the commands become usable after the
currently private packages are published. The code uses accessible high-contrast syntax coloring,
and a `Run example` control renders the generated definition through the actual public React package
with a restartable `idle` animation.

A production-build browser regression loaded Strobi with all bundled semantic keys removed, opened
Export and observed `Ready for runtime export` and `6/6 standard animations available`. The captured
download was schema v1 with 28 Expressions (including synthesized `neutral`), 23 Animations and zero
public `expression-*` references. The formatted-copy action produced valid JSON and its accessible
success status.

#### Implemented architecture

- `pnpm-workspace.yaml` declares `packages/*` and `examples/*`.
- `packages/avatar-core` owns the public schema/types/validator, bounded JSON parser, semantic
  manifests, geometry, surfaces, body model, ambient motion, pure playback state, definition-to-scene
  adapter, ESM build, declarations, README and package metadata.
- `src/features/avatar/{geometry,surfaces,body,ambientMotion}.ts` are compatibility re-exports from
  the shared core. `src/features/avatar/avatarDefinition.ts` keeps only the Studio-to-public adapter
  and re-exports the public contract.
- `packages/avatar-react` owns `<Avatar />`, its typed controller, CSS hooks, embedded/floating
  layouts, body portal, pointer capture, keyboard movement, position constraints/callbacks, SVG
  rendering and direct per-frame path/transform updates.
- `examples/react-vite-consumer` is the independent React fixture. `scripts/smoke-packages.mjs`
  builds and packs both packages, copies the fixture outside the workspace, forces the core
  dependency to the local tarball, installs, typechecks and builds.
- Runtime packages remain `private: true` and AGPL-3.0-only. Apache-2.0 relicensing and any npm
  publication remain blocked until every copyright holder and repository metadata are confirmed.
- The existing Studio ZIP export still consumes compatibility re-exports and strips new
  `semanticKey` fields from its legacy payload to avoid an unintended output change.

#### Final verification recorded on 2026-08-14

- Focused Studio/avatar regression suite: 3 files and 67 tests passed.
- `pnpm check`: passed, including generated-engine freshness, formatting, TypeScript, 19 test files
  and 162 tests, both package builds, and the production Studio build.
- `npm pack --dry-run --json`: passed; core contains 30 allow-listed files and React contains 10.
- `pnpm packages:smoke`: passed against newly built tarballs in a clean temporary consumer.
- Browser verification of the tarball consumer observed two SVGs/eight paths, working
  `play('idle')` and `setExpression('neutral')`, floating drag, no mobile horizontal overflow, and no
  application console or page errors.
- `git diff --check`: passed during final handoff.

#### Post-implementation constraints

- Decide licensing/repository metadata before removing `private: true` or publishing either package.
- Phase F requires a separate product decision; it is not a blocker for React v1.
- Local Vite preview still receives 404 responses for the pre-existing Vercel Analytics and Speed
  Insights scripts; the runtime example itself renders without JavaScript errors.

## 1. Context and objective

Bible Strong Avatar Lab is currently a React Studio for authoring procedural SVG avatars. It stores a complete Studio document in browser local storage, can import/export that document as JSON, and can generate ZIP exports containing a standalone browser runtime.

The next product capability is different from a Studio project export:

- a developer installs a reusable package with `pnpm add`;
- their application supplies one JSON avatar definition;
- a React component renders that avatar without the Studio UI;
- the application controls named expressions and named animations through a public API;
- the same component can render inside an ordinary `div` or float above a page and be dragged by the user.

The package must not require the consumer to install or run the Studio. It must not depend on Studio local storage, Studio document state, editor selection, or browser-only authoring concerns.

The public API must use semantic names such as `neutral`, `happy-smile`, `idle`, and `thinking`. It must never require callers to know implementation identifiers such as `expression-07`, `avatar-<uuid>`, or `shape-<uuid>`.

Avatar JSON is also the future compatibility boundary for copy/paste, file sharing, URL sharing, or a remote avatar registry. Those delivery mechanisms are explicitly out of scope for the first implementation; they must reuse this exact definition later rather than introduce another data format.

## 2. Existing-system constraints

The following constraints are mandatory when implementing this specification.

- Read `CONTEXT.md` and follow the root `AGENTS.md` before changing behavior.
- Geometry, playback and document operations remain framework-independent.
- React owns durable UI state; high-frequency rendering and dragging use Motion values or direct transforms, not React state updates for every pointer movement.
- Do not add `useMemo`, `useCallback`, or `memo`.
- Keep English, French, and Simplified Chinese Studio copy synchronized in `src/i18n/index.ts` and `src/i18n/zh.ts`.
- `src/features/export/standaloneEngine.generated.ts` is generated. Do not edit it manually; use `pnpm engine` if its source changes.
- The current Studio document is pre-release schema version 2. A migration for older pre-release documents is not required, but the bundled `defaultStudioDocument.json`, document parser, and tests must remain coherent.
- The existing export payload is not the new public schema. It is ZIP-export specific and currently omits a general semantic expression catalog.

## 3. Scope

### In scope

1. A versioned, JSON-serializable `AvatarDefinition` public contract.
2. Semantic expression and animation names in public exports.
3. A framework-independent runtime for validation, geometry resolution, and playback.
4. A React renderer package with embedded and floating layouts.
5. Pointer/touch dragging, optional keyboard repositioning, constraints, and position callbacks.
6. Studio authoring fields and export flow for the public definition.
7. Tests, package build verification, and consumer documentation.

### Explicitly out of scope

1. A remote avatar registry, short opaque IDs, authentication, permissions, or publication workflow.
2. Encoding avatar JSON into a URL fragment.
3. A Web Component or native/mobile renderer. The core API must leave these possible later.
4. Backwards compatibility with speculative prior public package formats. There is no public package yet.
5. Importing a runtime definition back into a full Studio project. This can be designed after export is stable.

## 4. Terminology

| Term               | Meaning                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Avatar definition  | The complete portable JSON contract consumed by the runtime.                                                         |
| Expression key     | Stable semantic machine name for one static pose, for example `happy-smile`.                                         |
| Animation key      | Stable semantic machine name for a playable sequence, for example `happy`.                                           |
| Expression         | A complete renderable pose: head, eyes, optional colors, perspective, and ambient motion.                            |
| Animation          | Ordered expression steps plus transition, playback, and blink settings.                                              |
| Standard animation | A runtime-supplied semantic animation such as `happy` or `thinking`, derived from the exported semantic expressions. |
| Runtime            | Framework-independent code that validates and advances an avatar definition.                                         |
| Renderer           | Code that turns runtime output into SVG/DOM.                                                                         |
| Embedded avatar    | An avatar laid out inside the supplied host element.                                                                 |
| Floating avatar    | An avatar positioned relative to the browser viewport.                                                               |

`id` is reserved for opaque internal identity only. It must not be required by any public runtime method or be used as a public expression/animation reference.

## 5. Public JSON contract

### 5.1 Contract principles

1. The object must be plain JSON and survive `JSON.stringify` / `JSON.parse` without loss of meaning.
2. Every expression is self-contained and has absolute eye values. The runtime must not need to reproduce Studio-only relative-eye inheritance to render an expression.
3. `expressions.neutral` is mandatory. The exporter synthesizes it from the avatar neutral appearance; it is not an editable Studio expression.
4. Every animation step references an expression key, not an array position or opaque ID.
5. Shape order is retained because it can affect visual stacking. Secondary shapes do not need public UUIDs or labels.
6. The definition must include all data required to render and play it. No runtime fetch is performed in v1.
7. A future schema version is a distinct contract. A v1 runtime must reject unsupported versions with a useful error; it must not guess.

### 5.2 TypeScript reference model

The implementation should export equivalent public types from `@bible-strong/avatar-core`. Exact property names below are normative unless a documented compatibility reason requires a change.

```ts
export type AvatarDefinition = {
  schema: 'bible-strong/avatar-definition'
  schemaVersion: 1
  name?: string
  body: AvatarBodyDefinition
  colors: AvatarColorsDefinition
  expressions: Record<ExpressionKey, AvatarExpressionDefinition>
  expressionOrder: ExpressionKey[]
  animations: Record<AnimationKey, AvatarAnimationDefinition>
  animationOrder: AnimationKey[]
  standardAnimationSet: 1
}

export type ExpressionKey = SemanticKey
export type AnimationKey = SemanticKey
export type SemanticKey = string
export type HexColor = `#${string}`

export type AvatarColorsDefinition = {
  body: HexColor
  eyes: HexColor
}

export type AvatarBodyDefinition = {
  primary: PrimarySurfaceDefinition
  nodes: AvatarBodyNodeDefinition[]
}

export type AvatarBodyNodeDefinition = {
  surface: BodyNodeSurfaceDefinition
  position: [number, number, number]
  rotation: [number, number, number]
}

export type SurfaceType =
  'sphere' | 'mickey' | 'cursor' | 'cube' | 'capsule' | 'cylinder' | 'cone' | 'diamond'
export type BodyNodeSurfaceType = Exclude<SurfaceType, 'mickey' | 'cursor'>

export type PrimarySurfaceDefinition = SurfaceDefinition<SurfaceType>
export type BodyNodeSurfaceDefinition = SurfaceDefinition<BodyNodeSurfaceType>

export type SurfaceDefinition<TType extends SurfaceType = SurfaceType> = {
  type: TType
  width: number
  height: number
  depth: number
  roundness: number
  morphRoundness?: number
  tipRoundness?: number
  baseRoundness?: number
}

export type AvatarExpressionDefinition = {
  head: { x: number; y: number; z: number }
  eyes: {
    left: { width: number; height: number; x: number; y: number; angle: number }
    right: { width: number; height: number; x: number; y: number; angle: number }
    spacing: number
  }
  perspective: number
  motion: {
    eyes: 'none' | 'microSaccades' | 'shake'
    body: 'none' | 'slowDrift' | 'shake'
  }
  colors?: Partial<AvatarColorsDefinition>
}

export type AvatarAnimationDefinition = {
  playbackMode: 'loop' | 'once' | 'pingPong'
  steps: AvatarAnimationStepDefinition[]
  blink: {
    enabled: boolean
    initialDelayMs: number
    minIntervalMs: number
    maxIntervalMs: number
    durationMs: number
  }
  metadata?: {
    label?: string
    description?: string
    group?: string
  }
}

export type AvatarAnimationStepDefinition = {
  expression: ExpressionKey
  holdMs: number
  transitionMs: number
  transition: 'spring' | 'smooth' | 'snappy'
}
```

### 5.3 Example

```json
{
  "schema": "bible-strong/avatar-definition",
  "schemaVersion": 1,
  "name": "Strobi",
  "body": {
    "primary": {
      "type": "sphere",
      "width": 240,
      "height": 240,
      "depth": 240,
      "roundness": 1
    },
    "nodes": []
  },
  "colors": {
    "body": "#5b7fe5",
    "eyes": "#111316"
  },
  "expressions": {
    "neutral": {
      "head": { "x": 0, "y": 0, "z": 0 },
      "eyes": {
        "left": { "width": 20, "height": 50, "x": 0, "y": -7, "angle": 0 },
        "right": { "width": 20, "height": 50, "x": 0, "y": -7, "angle": 0 },
        "spacing": 35
      },
      "perspective": 1,
      "motion": { "eyes": "none", "body": "none" }
    }
  },
  "expressionOrder": ["neutral"],
  "animations": {
    "idle": {
      "playbackMode": "loop",
      "steps": [
        {
          "expression": "neutral",
          "holdMs": 3000,
          "transitionMs": 500,
          "transition": "smooth"
        }
      ],
      "blink": {
        "enabled": true,
        "initialDelayMs": 2600,
        "minIntervalMs": 3400,
        "maxIntervalMs": 6200,
        "durationMs": 280
      }
    }
  },
  "animationOrder": ["idle"],
  "standardAnimationSet": 1
}
```

### 5.4 Semantic key rules

- Keys match `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`.
- `neutral` is required in `expressions` and is reserved for the neutral pose.
- `neutral` is synthesized during export from `defaultExpression` after applying the active avatar's eye defaults. It is reserved and cannot be assigned as an editable Studio semantic key.
- Expression keys are unique within `expressions`; animation keys are unique within `animations`.
- An expression and an animation may have the same key (for example `happy`), because they occupy different namespaces. Prefer a more descriptive expression key such as `happy-smile` when an animation uses multiple frames.
- Public keys are English machine keys. User-facing labels remain localizable Studio copy and must not be used for references.
- Custom Studio content must have a user-provided semantic key before it can be included in a runtime export. The export UI must show a precise error for missing, malformed, or duplicate keys.
- On duplicate, import and Studio validation reject the conflict; they must never silently add a numeric suffix.
- Duplicating an expression or animation clears its `semanticKey`; the user must explicitly name the duplicate before export.
- `expressionOrder` and `animationOrder` are complete, duplicate-free lists of their respective record keys. Consumers must not derive UI or playback order from object-key enumeration.

### 5.5 Validation and resource limits

The public contract is a committed JSON Schema Draft 2020-12 document. It is the single normative machine-readable source for the v1 data shape and is shipped from the public package. The core validates objects with Ajv configured for Draft 2020-12 and strict schema checking. Do not maintain a second Zod schema in the runtime: it would create two competing sources of truth. Zod may be used in a Studio-only form layer only when that layer is not a second definition validator.

The core exposes two distinct non-mutating APIs:

```ts
type AvatarDefinitionError = {
  path: string // RFC 6901 JSON Pointer, for example '/animations/happy/steps/1/expression'
  code: string
  message: string
}

type ValidationResult<T> =
  { ok: true; value: Readonly<T> } | { ok: false; errors: readonly AvatarDefinitionError[] }

function validateAvatarDefinition(value: unknown): ValidationResult<AvatarDefinition>
function parseAvatarDefinition(text: string): ValidationResult<AvatarDefinition>
```

`validateAvatarDefinition` accepts an already materialized JavaScript value. `parseAvatarDefinition` additionally enforces JSON text limits and rejects duplicate object members before `JSON.parse`-style parsing loses that information. Neither API rounds values, fills missing fields, discards unknown properties, changes color casing, or substitutes defaults. Canonical serialization, if introduced, is a separate explicit function and never validation side effect.

Studio persistence parsing may remain forgiving for local recovery; the public package boundary must reject invalid input rather than silently replacing it with a preset.

Validation must check at least:

- exact supported version;
- exact `schema: 'bible-strong/avatar-definition'` and `schemaVersion: 1`;
- no unknown properties at every object level in v1 (`additionalProperties: false`); future extensions require an explicit new schema version rather than ignored data;
- plain-object shape and no non-finite numbers;
- six-digit lowercase `#rrggbb` colors;
- known surface type;
- strictly positive dimensions;
- three-item finite position/rotation tuples;
- a maximum of 16 secondary nodes, 128 expressions, 64 explicit animations, and 128 steps per animation;
- presence of `expressions.neutral`;
- valid semantic keys;
- at least one animation step when an animation is present;
- every step references an existing expression key;
- raw input of at most 262,144 UTF-8 bytes and JSON nesting depth of at most 32;
- semantic keys and metadata `group` values of at most 64 characters, `name` and metadata `label` values of at most 120 characters, and metadata `description` values of at most 512 characters;
- primary and secondary dimensions in `0.001..10000`; body-node positions in `-10000..10000`; rotations in `-360..360`; perspective in `0.1..10`; and all roundness values in `0..1`;
- `holdMs` in `100..60000`, `transitionMs` in `0..5000`, and finite bounds for eyes and remaining expression coordinates chosen from the same `-10000..10000` rendering-safe range;
- `blink.initialDelayMs` in `0..60000`, `blink.minIntervalMs` and `blink.maxIntervalMs` in `250..120000`, `blink.durationMs` in `50..2000`, and `blink.minIntervalMs <= blink.maxIntervalMs`;
- text/semantic-key lengths, JSON nesting depth, and raw JSON byte length, with all initial limits documented and covered by boundary tests;
- an actionable JSON Pointer path, for example `/animations/happy/steps/1/expression`.

`parseAvatarDefinition` uses a tokenizing or streaming parser that tracks the current JSON Pointer, rejects the second occurrence of an object member, and applies the byte/depth/string limits before allocating unbounded structures. Ajv validates the resulting value against the JSON Schema. The validator returns a deeply immutable view or typed validation errors. It must not call browser APIs. The renderer cache must preserve provided geometry precision; it must not use a key that aliases definitions by rounding to four decimal places.

### 5.6 Standard animation set

`standardAnimationSet: 1` opts the definition into the version-1 runtime library of semantic animations. The runtime resolves this library from the semantic expressions present in the definition, without adding unexported Studio identifiers to the public format.

- `STANDARD_ANIMATIONS_V1` is a committed, versioned runtime manifest. Before the package can ship, it must define for every standard key its required expression keys, ordered steps, timing, transition, playback mode and blink settings. The initial intent catalogue is `idle`, `happy`, `sad`, `thinking`, `excited`, and `celebrate`; its exact semantic-expression mapping requires explicit product/design curation and must be committed with the manifest. No runtime may infer this mapping from a numeric Studio expression or from visual values.
- The runtime exposes an availability query that reports both available standard animations and unavailable ones with their missing semantic-expression requirements.
- An explicit animation in `animations` with the same key overrides the standard animation for that avatar. This is the sole override rule; duplicate alternatives are not exposed under invented names.
- `animations` may be `{}`. The avatar still renders `neutral` and may play every standard animation whose requirements are satisfied.
- `play(key)` resolves the overridden or standard animation. If it is unknown or unavailable, it returns the documented typed error; it must not fall back silently to `neutral`.
- Version 1 has one public animation per intention. Variants such as `happy.subtle` are not part of v1.

## 6. Studio model and export mapping

### 6.1 Internal versus public references

Existing Studio expressions and animation steps use durable internal IDs. Keep those IDs for editor operations, reordering, deletion, and current document integrity. Add an optional durable `semanticKey` to Studio Expressions and Animations; this key is the public export name.

Suggested internal additions:

```ts
type Expression = {
  id: string
  semanticKey?: string
  // existing rendering fields
}

type AvatarSequence = {
  id: string
  semanticKey?: string
  // existing playback fields
}
```

Internal sequence steps continue to reference `expressionId`. The runtime exporter maps those IDs to expression semantic keys. This preserves current Studio behavior and does not force editor code to use display-facing data as a primary key.

### 6.2 Baseline semantic catalog

The bundled expression catalog is currently numeric. A product owner or designer must curate the semantic keys for every expression that is intended to be exported. Do not fabricate semantic meanings from an expression index.

Implementation steps:

1. Inventory each bundled expression visually.
2. Assign a clear unique semantic key, such as `look-left`, `sleepy-eyes`, or `happy-smile`. `neutral` is reserved for the synthesized public pose and must not be assigned here.
3. Assign every bundled animation an existing semantic key. Existing state names such as `idle`, `thinking`, and `happy` are suitable starting keys after validation.
4. Update `defaultStudioDocument.json` with the curated keys.
5. Update default constructors and tests so newly created custom content starts without a key and is visibly marked as not export-ready.

Because the project is pre-release, extend the current v2 document parser, serializer, default
document, and behavior-copy operations coherently instead of introducing another schema version.
When approved bundled items are loaded without their keys, restore the known keys by durable internal
ID so the bundled avatar remains exportable. Never invent a key for custom content: custom items
remain editable but cannot be exported until the user supplies a valid key. The parser must
round-trip `semanticKey` for both base behavior and Avatar-owned behavior; it must not drop it as an
unknown field after reload.

### 6.3 Expression resolution during export

Studio stores expressions relative to avatar-level neutral eye values. The runtime schema stores complete absolute expression values. Create a pure conversion function:

```ts
createAvatarDefinition({
  avatar,
  behavior: resolveAvatarBehavior(document, avatar),
}: {
  avatar: StudioAvatar
  behavior: AvatarBehaviorLibrary
}): ValidationResult<AvatarDefinition>
```

It must:

1. map the primary body and secondary nodes, stripping Studio-only node IDs/names;
2. map avatar base colors;
3. synthesize `expressions.neutral` from `defaultExpression` and apply `applyAvatarEyeDefaults` to it and every exported expression;
4. convert flat Studio expression fields into the structured public expression shape;
5. retain expression color overrides and ambient motion;
6. map each animation step from `expressionId` to its expression semantic key;
7. fail if an included expression/animation has no valid semantic key or an animation references an excluded expression;
8. generate the explicit standard-animation availability report and the declared catalog order;
9. validate the finished object with the core validator before returning it.

The `neutral` runtime expression must be a complete resolved representation of the Avatar's neutral visual appearance. It is not sufficient to export `defaultExpression` without applying the avatar eye defaults. This synthesized expression is always first in `expressionOrder`.

### 6.4 Export scope

The runtime JSON export must include all semantic expressions and explicit animations owned by the active avatar behavior library, not only the animations selected for the current ZIP export. Standard animations are supplied by the declared standard-animation set when their requirements are met. An application that installs the package must be able to discover every available key through the runtime API.

The existing React/JavaScript ZIP export can keep its animation selection UI. Refactor it to derive selected subsets from `AvatarDefinition` or a shared normalized intermediate representation, without changing its public generated output unintentionally.

## 7. Package architecture and build

### 7.1 Package layout

Convert the repository to a pnpm workspace. The public package cannot be released from the current single private application package. Required layout:

```text
packages/
  avatar-core/
  avatar-react/
  avatar-vue/                 # adapter planned after React v1
  avatar-angular/             # adapter planned after React v1
examples/
  react-vite-consumer/
src/                         # existing Studio application
```

Package names:

- `@bible-strong/avatar-core`
- `@bible-strong/avatar-react`
- `@bible-strong/avatar-vue`
- `@bible-strong/avatar-angular`

The Studio remains AGPL-3.0-only. Subject to confirmation by every copyright holder before publication, the runtime packages are released under Apache-2.0, with their own `LICENSE` files and unambiguous package metadata. Do not publish any package before that confirmation and repository ownership/metadata have been verified.

This is deliberately not a façade package. A consumer installs only the adapter for its framework; that adapter brings a compatible `avatar-core` version as its normal dependency. The independent core can also be installed directly for non-UI rendering, validation, servers, or a future framework adapter.

`avatar-react` depends on `avatar-core`. React and React DOM must be peer dependencies of `avatar-react`, compatible with React 19. `avatar-vue` must declare Vue as a peer dependency and `avatar-angular` must declare the Angular packages it imports as peer dependencies. No adapter may bring React, Vue, Angular, or another UI framework into another adapter's dependency graph. The core package must have no React, Vue, Angular, Motion, or DOM dependency.

The initial release scope is `avatar-core` and `avatar-react`. Vue and Angular are planned follow-on adapters, built only after the cross-adapter conformance suite exists. They must expose the same JSON contract, semantic keys, playback rules, availability errors, and embedded/floating behavior; only the host-framework binding may differ.

`avatar-angular` must be built as an Angular library in the Angular Package Format using partial compilation, with a deliberately small public API entry point. The React and Vue adapters must externalize their framework dependencies in library builds. Every public package must declare a narrow `files` allow-list and explicit `exports`; consumers must not import package internals.

Do not move unrelated Studio UI into packages. Extract only reusable domain/runtime code.

### 7.2 Core responsibilities

`@bible-strong/avatar-core` exports:

- public types and validation;
- conversion helpers needed by package consumers, if safe;
- expression interpolation, blink timeline, and animation timeline primitives;
- SVG geometry data generation or a renderer-neutral scene model;
- colors and ambient motion calculations;
- semantic catalog lookup helpers;
- typed errors for unknown expression/animation keys.

Playback is a pure state machine. The core receives a monotonic `now()` clock and an injectable `random()` source; browser adapters alone use `performance.now()` and non-deterministic randomness. It exposes a pure `advance(state, now, environment)` operation so pause/resume, blink timing, and tests are deterministic.

For every sequence step, the normative timeline is `[transitionMs -> holdMs]`: interpolate from the current pose to the target expression for exactly `transitionMs`, then keep the target pose for exactly `holdMs` before the next step. `spring` is a deterministic bounded damped easing over the specified transition duration, not an unbounded physical simulation. `smooth` and `snappy` are likewise bounded easing functions. Pause preserves the exact timeline progress and resumes from that same progress.

The core must expose enough to support a future non-React renderer. It must not own DOM nodes, pointer events, CSS layout, portals, clipboard actions, or browser storage.

### 7.3 React responsibilities

`@bible-strong/avatar-react` exports at minimum:

```ts
export function Avatar(props: AvatarProps): React.ReactElement
export type AvatarController = {
  play(animation: AnimationKey): AvatarCommandResult
  setExpression(expression: ExpressionKey): AvatarCommandResult
  pause(): void
  stop(): void
  getState(): AvatarPlaybackState
}

export type AvatarCommandResult = { ok: true } | { ok: false; error: AvatarRuntimeError }

export type AvatarRuntimeError = {
  code:
    | 'unknown_animation'
    | 'unavailable_standard_animation'
    | 'unknown_expression'
    | 'controlled_by_props'
  key: string
  message: string
}

export type AvatarPlaybackState = {
  activeAnimation?: AnimationKey
  activeExpression: ExpressionKey
  status: 'playing' | 'paused' | 'stopped'
}
```

The component renders semantic SVG paths from core output. It may reuse the project Motion strategy for smooth, high-frequency visual updates, but rendering behavior must match core calculations.

The public component must not expose internal Studio IDs, `AvatarSequence`, `Expression`, or Studio document types.

### 7.4 Distribution requirements

- Build ESM and TypeScript declarations.
- Configure `exports` in each package `package.json`.
- Mark source maps appropriately for debugging.
- Keep peer dependencies external; do not bundle a second React copy.
- Add a `pnpm pack` smoke test or equivalent that installs the packed artifacts into `examples/react-vite-consumer`.
- Run `npm pack --dry-run --json` and install actual tarballs into a clean, non-workspace consumer before publishing.
- Document the package entry points and supported React version.

## 8. React rendering and control API

### 8.1 Component props

```ts
type AvatarProps = {
  definition: AvatarDefinition
  ref?: React.Ref<AvatarController>
  /** Controlled playback target. Mutually exclusive with expression. */
  animation?: AnimationKey
  /** Controlled static pose. Mutually exclusive with animation. */
  expression?: ExpressionKey
  /** Uncontrolled initial playback target. */
  defaultAnimation?: AnimationKey
  /** Uncontrolled initial static pose; defaults to neutral. */
  defaultExpression?: ExpressionKey
  autoplay?: boolean
  size?: number | string
  className?: string
  style?: React.CSSProperties
  mode?: 'embedded' | 'floating'
  /** Floating mode portal destination; defaults to document.body after hydration. */
  portalContainer?: HTMLElement
  draggable?: boolean
  constrainTo?: 'none' | 'viewport' | 'parent'
  position?: { x: number; y: number }
  initialPosition?: FloatingInitialPosition
  zIndex?: number
  ariaLabel?: string
  /** At most once per animation frame while dragging; never makes position controlled. */
  onPositionPreview?: (position: { x: number; y: number }) => void
  /** Final committed position after pointer/keyboard movement. */
  onPositionCommit?: (position: { x: number; y: number }) => void
  onDragStart?: () => void
  onDragEnd?: (position: { x: number; y: number }) => void
  onAnimationEnd?: (animation: AnimationKey) => void
  onExpressionChange?: (expression: ExpressionKey) => void
}

type FloatingInitialPosition =
  { x: number; y: number } | { top?: number; right?: number; bottom?: number; left?: number }
```

Rules:

- `definition` is required and immutable from the component's perspective. When its reference changes, validate and reinitialize the runtime predictably.
- `animation` and `expression` are controlled props and mutually exclusive. In development, reject both with a clear error. They always take priority over defaults and imperative commands.
- When neither controlled prop is supplied, `defaultAnimation` or `defaultExpression` initializes uncontrolled playback; if neither is supplied, render `neutral` without playback. `autoplay={false}` initializes the selected default target as a static pose; `autoplay` defaults to `true` only when `defaultAnimation` is provided.
- `mode` defaults to `embedded`.
- `draggable` defaults to `false`.
- `constrainTo` defaults to `viewport` for floating avatars and `none` for embedded avatars. `parent` is valid only when an appropriate parent element exists.
- A controlled `position` always wins over `initialPosition`. The component emits rAF-limited `onPositionPreview` while dragging and `onPositionCommit` after commit, but does not hold authoritative position in controlled mode.
- `size` changes only visual layout; it must not modify the supplied avatar definition.

### 8.2 Controller behavior

- `play(key)` starts or restarts the named animation from its first step.
- `setExpression(key)` stops animation playback and renders that static expression.
- `pause()` freezes current animation progress. Calling `play` while paused resumes the current animation only when called with the current key; otherwise it starts the requested key.
- `stop()` stops playback and returns to `neutral`.
- An unknown or unavailable key does not fail silently. `play` and `setExpression` return `AvatarCommandResult`; they never throw for expected caller input errors.
- In controlled mode, `play` and `setExpression` return `{ ok: false, error: { code: 'controlled_by_props', ... } }`; the consumer changes the controlled prop instead.
- `onAnimationEnd` fires only when a `once` animation completes naturally.
- `onExpressionChange` fires when the active semantic expression changes, including sequence-step changes and direct `setExpression` calls.

React 19 exposes the controller through the ordinary `ref` prop: `ref?: React.Ref<AvatarController>`. The package must not use an incompatible `forwardRef` wrapper.

## 9. Layout and dragging

### 9.1 Embedded mode

Embedded is the default:

```tsx
<div className="assistant-zone">
  <Avatar definition={avatar} animation="idle" />
</div>
```

The component participates in normal React layout. It must not use a portal. With `draggable` and `constrainTo="parent"`, movement is constrained to the containing element's content box. Document that the parent needs a definite rendered size; the package may add the minimum positioning style required for dragging but must not unexpectedly alter the parent layout.

### 9.2 Floating mode

Floating mode is page-relative:

```tsx
<Avatar
  definition={avatar}
  mode="floating"
  draggable
  initialPosition={{ right: 32, bottom: 32 }}
  zIndex={1000}
/>
```

It renders a fixed-position wrapper relative to the viewport. The initial position supports either `{ x, y }` from the top-left viewport origin or one of the documented edge-anchor forms such as `{ right, bottom }`. Normalize initial values once to a pixel `{ x, y }` position.

Floating mode renders through a React portal to `document.body` by default, after hydration. This guarantees viewport-relative positioning even when an ancestor establishes a containing block through `transform`, `filter`, or containment. `portalContainer` opt-in replaces `document.body` for hosts that require a dedicated overlay root.

During server-side rendering, and until client hydration can create the portal, render a fixed-size neutral placeholder in the caller tree. Browser APIs, media queries, pointer listeners, and the portal must be initialized only after mount. SVG definition IDs must use React `useId` so multiple avatars and SSR hydration never collide.

### 9.3 Pointer and keyboard interaction

Implement dragging with Pointer Events:

1. On primary pointer down, record pointer origin and current avatar position.
2. Call `setPointerCapture(pointerId)` on the draggable wrapper.
3. Update only transform/Motion values while the pointer moves. Do not call React `setState` on each pixel.
4. Clamp the proposed position to the selected viewport or parent bounds.
5. On pointer up/cancel or lost pointer capture, release capture, commit the final position, and invoke callbacks. On cancel, restore the drag origin before reporting it.

While drag is active:

- use `touch-action: none` only on the draggable avatar surface;
- prevent accidental text selection and image dragging;
- expose an appropriate pressed visual state without deprecated `aria-grabbed` metadata and without suppressing the avatar animation;
- do not interfere with keyboard navigation outside the component.

For accessibility, when `draggable` is true the wrapper must be focusable and expose instructions through an accessible label or description. Arrow keys move by 10 px; Shift+Arrow moves by 1 px. Position changes clamp exactly as pointer movement does. Escape cancels an in-progress pointer drag and restores its origin. The package also renders accessible move-left, move-right, move-up, move-down and reset controls when dragging is enabled, so movement does not rely solely on dragging.

### 9.4 Reflow and bounds

- Re-clamp an uncontrolled position when the viewport resizes.
- Re-clamp embedded parent constraints using `ResizeObserver`.
- Do not overwrite controlled positions; instead expose the clamped suggested position through `onPositionChange` when a parent resize makes the supplied position invalid.
- Preserve sub-pixel position internally only if the Motion implementation requires it; public callbacks may return finite pixel numbers.

The avatar definition contains no display position. Consumers decide whether and how to persist `position` in local storage, a profile, or their own backend.

## 10. Studio UX changes

1. Add a semantic-key field to the expression editor and animation editor.
2. Display a concise validation message for a missing/invalid/duplicate key.
3. Do not translate the key itself. Translate the field label, help text, and validation errors.
4. Add an export action named equivalent to `Export avatar runtime JSON` in all three languages.
5. Export the active avatar's complete effective behavior library, after resolving inherited base behavior.
6. Export a `.avatar.json` file. Suggested filename: a sanitized avatar name followed by `.avatar.json`.
7. Add a copy-to-clipboard action only after the file export is verified; it copies formatted JSON and reports success/failure accessibly.
8. Keep the existing full Studio project import/export unchanged. Its purpose remains authoring backup, not runtime integration.
9. Keep the existing ZIP export working; refactor only after snapshot and generated-package tests prove no regression.

## 11. Implementation plan

Implement in the following order. Each step must compile and have focused tests before moving to the next.

### Phase A - Contract and pure conversion

1. Add `src/features/avatar/avatarDefinition.ts` as a framework-independent temporary home for the v1 contract, validator, and Studio-to-runtime conversion.
2. Commit the JSON Schema Draft 2020-12, its Ajv validator, and the bounded duplicate-detecting JSON-text parser; define public types and validation errors exactly as described in section 5.
3. Write conversion from `StudioAvatar`, its resolved behavior, and current Studio types to `AvatarDefinition`.
4. Apply avatar eye defaults during conversion and flatten internal fields into the structured public expression shape.
5. Add unit tests for valid conversion, invalid semantic keys, missing `neutral`, unresolved animation references, colors, body nodes, and non-finite values.
6. Add semantic-key fields to Studio internal types, parser, default document, and focused tests.

Deliverable: `createAvatarDefinition(...)` returns validated JSON-ready data without importing React or browser APIs.

### Phase B - Semantic Studio authoring

1. Inventory the bundled poses visually, propose their semantic keys and an exact `STANDARD_ANIMATIONS_V1` manifest, then obtain product/design approval before committing it.
2. Add inputs to the expression and animation editors.
3. Add per-field validation and export-readiness indication.
4. Add localized copy in English, French, and Simplified Chinese.
5. Add a runtime JSON download action for the active avatar.
6. Add tests proving default data has a valid export and custom missing keys are rejected at export.

Deliverable: a Studio user can produce a complete `.avatar.json` without manually editing JSON.

### Phase C - Extract core package

1. Create the pnpm workspace/package configuration and `packages/avatar-core`.
2. Move or re-export the framework-independent contract, geometry, ambient motion, and playback primitives without changing their behavior.
3. Define an adapter between public `AvatarDefinition` expressions and existing rendering geometry structures.
4. Ensure the core can render a scene and advance playback without DOM/React imports.
5. Update Studio imports to use the shared core where appropriate; do not create circular dependencies from packages back into `src/`.
6. Configure ESM build, declarations, exports, and package metadata.

Deliverable: a Node/Vitest test can load a JSON fixture, resolve `idle`, advance it, and generate the same geometry as Studio.

### Phase D - React renderer package

1. Create `packages/avatar-react` with React peer dependencies.
2. Implement `<Avatar />`, SVG rendering, palette resolution, clipping, eye visibility, blink rendering, and animation scheduling.
3. Implement the imperative controller with `forwardRef` or the React 19-compatible ref pattern selected by the codebase.
4. Implement embedded layout first, then floating layout.
5. Implement pointer capture, controlled/uncontrolled position, viewport/parent constraints, ResizeObserver, and keyboard movement.
6. Ensure continuous drag/render updates use transform/opacity and Motion values or equivalent high-frequency primitives.
7. Document CSS hooks/classes and provide a minimal visual default without forcing an application theme.

Deliverable: a Vite React fixture renders one supplied avatar and can call `play('happy')` and `setExpression('neutral')`.

### Phase E - Integrate existing export and package verification

1. Refactor existing ZIP export to use shared normalized data where practical.
2. Run `pnpm engine` if standalone-engine source changes, then retain the generated file in the change.
3. Build both packages.
4. Pack them and install into the consumer fixture using package artifacts, not workspace shortcuts.
5. Validate production build and behavior in the fixture.
6. Add README/API documentation and a sample `strobi.avatar.json`.

Deliverable: an external project can install the packed package and use the documented API without importing Studio source.

### Phase F - Additional framework adapters (after React v1)

1. Define framework-neutral conformance fixtures from the public JSON examples and standard-animation manifest.
2. Create `packages/avatar-vue`, with Vue as a peer dependency, and prove the same render/playback/drag contract against the fixtures.
3. Create `packages/avatar-angular` through the Angular library tooling, publish only partial-Ivy output, and keep Angular packages as peer dependencies.
4. Pack every adapter and install it into a clean consumer for its own framework; never validate an adapter solely through workspace linking.

Deliverable: each supported framework exposes a native component API around the same versioned avatar engine, without duplicating geometry or playback logic.

## 12. Test plan and acceptance criteria

### 12.1 Core contract tests

- A valid example parses and round-trips through `JSON.stringify`/`JSON.parse`.
- `parseAvatarDefinition` rejects duplicate JSON object members, input over 256 Kio, depth over 32, unknown fields, and every documented numeric/string boundary.
- Unsupported version fails explicitly.
- Invalid path-specific errors are returned for malformed keys and dangling expression references.
- Conversion preserves every supported primary-surface parameter.
- Conversion preserves all secondary-node surfaces, order, positions, and rotations.
- Converted expressions use final resolved eye values.
- Base and per-expression colors render correctly.
- Animation timing, transitions, playback mode, and blink settings survive conversion.

### 12.2 Rendering and playback tests

- Geometry generated from a converted definition matches the geometry generated from the equivalent Studio avatar/expression.
- `neutral` is rendered when nothing is playing.
- `play('idle')` starts its first semantic step.
- `setExpression('happy-smile')` stops playback and uses that exact expression.
- `once` triggers exactly one completion callback.
- unknown semantic names produce the documented error.
- reduce-motion behavior remains deterministic and documented.

### 12.3 React and interaction tests

- Embedded mode is rendered inside the supplied parent without fixed positioning.
- Floating mode uses viewport-relative fixed positioning.
- Floating mode remains viewport-relative when its caller is under a transformed ancestor, and has no hydration warning during its portal handoff.
- Pointer drag changes position and captures pointer outside the avatar bounds.
- `constrainTo="viewport"` and `constrainTo="parent"` never place the avatar outside their bounds.
- Controlled props take priority over imperative commands; uncontrolled defaults and controller commands work predictably.
- Controlled position reports rAF-limited previews and final commits but does not become internally authoritative.
- Uncontrolled position is re-clamped after a resize.
- Keyboard arrows reposition a draggable avatar; Escape cancels active drag.
- Accessible movement and reset controls work without pointer dragging.
- Dragging does not cause one React render per pointer move (test through implementation boundary or profiler-friendly instrumentation, not fragile timing assumptions).

### 12.4 Package smoke test

The consumer fixture must:

1. install both built tarballs;
2. import the public package APIs and a JSON fixture;
3. typecheck;
4. build with Vite;
5. run a browser-level assertion that the SVG is visible, `play('idle')` works, and a draggable floating avatar moves.

### 12.5 Required commands before handoff

Run at minimum:

```bash
pnpm typecheck
pnpm test -- <focused-files>
pnpm engine:check
pnpm check
```

Run package-specific build/test/pack commands introduced by the implementation as well. Report their exact result in the final handoff.

## 13. Definition of done

This work is complete only when all of the following are true:

1. A Studio user can export one valid `.avatar.json` for the active avatar.
2. That JSON uses semantic expression and animation keys, with no public opaque references.
3. The JSON contains all required geometry, colors, expressions, and animations to render without Studio code or data.
4. An independent React Vite project can install the packages with pnpm and render the JSON.
5. The independent project can invoke semantic animation/expression controls.
6. The independent project can use the same component embedded in a `div` or floating over the viewport.
7. A floating or constrained embedded avatar is draggable by pointer/touch and keyboard, with correct preview/commit callbacks and bounds.
8. Existing Studio project persistence, snapshots, and ZIP exports still pass their tests.
9. All typecheck, targeted tests, `pnpm engine:check`, and `pnpm check` pass.
10. Public API and JSON schema documentation are sufficient for an external developer to integrate without reading Studio source.

## 14. Future extensions

After v1 is stable, the same `AvatarDefinition` can be carried by:

- a copyable Base64URL token;
- a URL fragment for direct sharing;
- a remote registry returning a short `avatarId`;
- a CDN-hosted JSON file;
- a Web Component or a non-React renderer.

None of these extensions may alter the meaning of an existing v1 definition. They are transport or rendering adapters around the contract defined here.
