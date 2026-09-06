import { getNarraGatewayConfig } from "../ai/narra-gateway-fetch";
import { localNarraGatewayScope } from "../ai/narra-gateway-scope";

/** Capture once before async work; remote installations retain their exact paths. */
export function backendCacheRoot(legacyRoot: string): string {
  const scope = localNarraGatewayScope(getNarraGatewayConfig().baseUrl);
  // Hex encoding is fixed for credentials; split only filesystem components so
  // long URL prefixes do not exceed NAME_MAX. Short existing scopes stay exact.
  const directoryScope = scope?.match(/.{1,240}/g)?.join("/");
  return directoryScope ? `${legacyRoot.replace(/\/+$/, "")}/local/${directoryScope}` : legacyRoot;
}
