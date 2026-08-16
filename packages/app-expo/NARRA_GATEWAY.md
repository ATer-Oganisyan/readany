# Narra character gateway

The character feature is isolated from the app's general Narra AI configuration. It has no
hardcoded deployment URL or API key.

Configure the Expo build with:

```sh
EXPO_PUBLIC_NARRA_GATEWAY_URL=https://your-gateway.example
EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE=installation
```

For local UI review without waiting for the external gateway, enable development-only fixtures:

```sh
EXPO_PUBLIC_NARRA_USE_MOCKS=1
```

This flag is ignored by production bundles. It seeds character cards, locked states, memory, and a
short sample conversation when the user starts character analysis.

`EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE` is optional. With `installation`, the client uses the
installation registration/refresh flow from Arsen's branch and stores the generated installation
secret in SecureStore. Without it, requests are sent without an Authorization header, which is
useful for a local gateway or a host-provided adapter.

Expected contract (adapted from `nara/customize`):

- `POST /v2/installations/register` and `/refresh` when installation auth is enabled;
- `POST /v2/ai/chat/stream` for character analysis (SSE or `{ "text": "..." }` response);
- `POST /v2/ai/chat/complete` for character chat and memory (`{ "text": "..." }` response);
- `POST /v2/media/images` for static portraits and scene illustrations (base64 or URL response);
- `POST /v2/media/cover` for generated book covers (`{ "image": "<base64>", "mime_type": "..." }` response);
- `POST /v2/speech/synthesize` for optional response playback.

The repository also defines the server-side book contract:

- `POST /v2/books/resolve` to bind a local SHA-256 to a catalog or private edition;
- `POST /v2/books/local` to register local-only metadata without uploading source bytes;
- `POST /v2/books/:bookEditionId/local-markup` to publish derived character profiles and
  fractional appearance anchors without extracted prose;
- `POST /v2/books/:bookEditionId/progress` with `progress_fraction`; the backend converts it to
  a canonical text watermark using the markup's normalized `text_length`;
- `GET /v2/books/:bookEditionId/manifest` for reader-visible characters and atomic media bundles.
  An HTTP `202` processing manifest may also contain `provisional: true` scan findings and scan
  progress before the canonical markup is published;
- reader-authorized media downloads; source download is catalog-only.

The gateway implementation is in `services/narra-gateway`; deployment still requires a configured
URL, PostgreSQL, Generator and S3-compatible storage. Until a URL is supplied by the build
environment (or a host calls `setNarraGatewayAdapter`), the UI remains available and shows a
configuration error when a network-backed action starts. Published characters, memories, chat
history and verified server media file paths are persisted locally by the app store. Provisional
characters stay local to the open character-list screen, cannot open chat, and are replaced by the
next processing or final manifest.
