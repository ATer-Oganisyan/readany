# Avatar Runtime Semantic Curation

## Status

Approved by Éric on 2026-08-14. This document is the product/design source for the committed
`STANDARD_ANIMATIONS_V1` runtime manifest.

Implementation state: complete. The approved expression keys, explicit animation keys, and
`STANDARD_ANIMATIONS_V1` manifest are present in the bundled Studio data and runtime contract. This
approval gate no longer blocks phase C; overall implementation progress is tracked in
`20260814-avatar-runtime-npm-package-and-semantic-api.md`.

It implements the human-validation gate required by
`20260814-avatar-runtime-npm-package-and-semantic-api.md`, phase B, step 1. No semantic key or
standard-animation mapping below may be copied into bundled data or runtime code before explicit
approval. That approval has now been recorded below.

## Expression catalogue proposal

The 27 bundled Studio expressions were rendered with the framework-independent SVG geometry engine
and visually inventoried. Internal IDs remain editor-only identifiers and will not be exposed by the
runtime.

| Internal expression ID                            | Proposed semantic key   | Visual reading                           |
| ------------------------------------------------- | ----------------------- | ---------------------------------------- |
| `expression-00`                                   | `upward-side-glance`    | Eyes raised toward one side              |
| `expression-01`                                   | `downward-gaze`         | Medium eyes looking downward             |
| `expression-05`                                   | `skeptical-right`       | One vertical eye and one horizontal eye  |
| `expression-06`                                   | `small-attentive`       | Small attentive eyes                     |
| `expression-12`                                   | `wide-downward-gaze`    | Large round eyes looking downward        |
| `expression-03`                                   | `surprised-left`        | Large offset eyes with a tilted head     |
| `expression-04`                                   | `sleepy-squint`         | Narrow tired eyes                        |
| `expression-07`                                   | `angry-right`           | Tense angular gaze                       |
| `expression-08`                                   | `curious-left`          | Uneven sideways gaze                     |
| `expression-09`                                   | `asymmetric-down-right` | One large and one small eye              |
| `expression-10`                                   | `attentive-left`        | Slightly tilted attentive gaze           |
| `expression-11`                                   | `joyful-wide`           | Very large open eyes                     |
| `expression-13`                                   | `eyes-closed`           | Closed, lowered eyes                     |
| `expression-02`                                   | `joyful-down-right`     | Large eyes angled downward               |
| `expression-14`                                   | `skeptical-left`        | Opposite skeptical gaze                  |
| `expression-15`                                   | `far-right-glance`      | Small eyes strongly offset to one side   |
| `expression-16`                                   | `angry-left`            | Opposite angular gaze                    |
| `expression-17`                                   | `playful-right`         | Lively uneven gaze                       |
| `expression-18`                                   | `asymmetric-up-left`    | One large and one small raised eye       |
| `expression-19`                                   | `gentle-downward-gaze`  | Soft downward gaze                       |
| `expression-20`                                   | `wide-down-left`        | Very large lowered eyes                  |
| `expression-21`                                   | `surprised-wide-left`   | Wide round eyes, alternate surprise pose |
| `expression-22`                                   | `drowsy-closed`         | Nearly closed raised eyes                |
| `expression-23`                                   | `suspicious-right`      | Wary sideways gaze                       |
| `expression-24`                                   | `shy-downward`          | Small lowered eyes                       |
| `expression-3d2bed26-f97c-477d-922f-77600cb10e92` | `angry-brows`           | Strongly inward-sloping eyes             |
| `expression-5220eaee-32fe-4bd8-ad31-432189534cc8` | `uneasy-left`           | Uneven worried gaze                      |

## Explicit animation-key proposal

The 23 bundled animations already have unique English machine IDs. The proposal is to use each
existing ID unchanged as its `semanticKey`:

`sleeping`, `waking`, `idle`, `listening`, `thinking`, `searching`, `working`, `excited`, `bored`,
`suspicious`, `angry`, `drowsy`, `happy`, `curious`, `confused`, `surprised`, `proud`, `shy`, `sad`,
`laughing`, `scared`, `playful`, and `celebrate`.

## `STANDARD_ANIMATIONS_V1` proposal

This proposal retains the established Studio sequence order, timing, playback, and blink behavior.
All steps use `transitionMs: 500` and `transition: "smooth"`.

| Standard key | Ordered semantic-expression steps                                                                    | `holdMs` per step | Playback mode | Blink: initial / min / max / duration (ms) |
| ------------ | ---------------------------------------------------------------------------------------------------- | ----------------: | ------------- | ------------------------------------------ |
| `idle`       | `upward-side-glance` -> `curious-left`                                                               |              5200 | `loop`        | 2600 / 3400 / 6200 / 280                   |
| `happy`      | `joyful-down-right` -> `joyful-wide` -> `playful-right` -> `gentle-downward-gaze`                    |              2300 | `loop`        | 2100 / 2800 / 5000 / 260                   |
| `sad`        | `sleepy-squint` -> `eyes-closed` -> `drowsy-closed`                                                  |              3600 | `loop`        | 4800 / 6500 / 9500 / 420                   |
| `thinking`   | `curious-left` -> `angry-left` -> `skeptical-left` -> `playful-right` -> `skeptical-right`           |              2300 | `loop`        | 2100 / 2800 / 5000 / 260                   |
| `excited`    | `joyful-down-right` -> `playful-right` -> `surprised-wide-left` -> `surprised-left` -> `joyful-wide` |              2300 | `loop`        | 1200 / 1800 / 3600 / 220                   |
| `celebrate`  | `joyful-down-right` -> `curious-left` -> `playful-right`                                             |              2300 | `loop`        | 1200 / 1800 / 3600 / 220                   |

For each row, the required expression keys are the unique keys appearing in its ordered steps. An
explicit animation with the same key will override the corresponding standard animation, as required
by the v1 runtime specification.

## Approval record

Approver: Éric

Decision date: 2026-08-14

Decision: approved as proposed

Requested changes: none recorded
