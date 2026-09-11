// Hermes (React Native) only supports UTF-8 in TextDecoder.
// text-encoding polyfill detects the native TextDecoder and skips installing
// its own full-encoding version. Workaround: temporarily hide the native
// TextDecoder so the polyfill installs unconditionally, then restore native.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _nativeTD = globalThis.TextDecoder;
const _nativeTE = globalThis.TextEncoder;
// @ts-expect-error — temporarily remove native TextDecoder/TextEncoder
globalThis.TextDecoder = undefined;
// @ts-expect-error
globalThis.TextEncoder = undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const { TextDecoder: PolyfillTextDecoder } = require("text-encoding") as {
  TextDecoder: typeof TextDecoder;
};
// Restore native TextDecoder/TextEncoder for rest of the app
globalThis.TextDecoder = _nativeTD;
globalThis.TextEncoder = _nativeTE;
