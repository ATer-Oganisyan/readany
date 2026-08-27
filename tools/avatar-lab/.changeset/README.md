# Changesets

Every user-visible package change must include a changeset created with `pnpm changeset`.

The three runtime packages use one fixed version while the public API stabilizes. Select:

- `patch` for compatible fixes and documentation corrections;
- `minor` for compatible features and for breaking changes while the version is below `1.0.0`;
- `major` only after the packages have reached `1.0.0`.

Merging the generated release pull request publishes the versions recorded in that pull request.
