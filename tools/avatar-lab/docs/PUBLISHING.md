# Publishing the runtime packages

The runtime is published as three public npm packages:

- `@bible-strong/avatar-core` contains the validation, playback and renderer-neutral scene APIs;
- `@bible-strong/avatar-react` depends on core and provides the React 19 integration;
- `@bible-strong/avatar-web` depends on core and provides the direct DOM/ESM integration.

All three packages keep the same version during the `0.x` stabilization period. Semantic Versioning
is applied as follows:

- a compatible fix increments the patch version (`0.1.0` to `0.1.1`);
- a compatible feature increments the minor version (`0.1.0` to `0.2.0`);
- a breaking change also increments the minor version while below `1.0.0`;
- after `1.0.0`, a breaking change increments the major version.

## Normal release flow

1. Add a changeset to every pull request that changes a published API with `pnpm changeset`.
2. Merge changes into `main`.
3. The release workflow updates or creates a release pull request containing version and changelog
   changes.
4. Review and merge that release pull request.
5. The workflow validates, builds and publishes every unpublished version to npm.

Publication uses npm trusted publishing through GitHub Actions OIDC. It does not require a stored
`NPM_TOKEN`. Each npm package must trust the `release.yml` workflow in the
`smontlouis/bible-strong-avatar-lab` repository.

## Local verification

Run the complete project checks and verify real consumer projects against packed tarballs:

```sh
pnpm check
pnpm packages:smoke
```

Do not run `npm publish` from an individual package for routine releases. The initial `0.1.0`
bootstrap publication is the only manual release.
