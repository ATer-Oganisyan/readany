/** Keep this encoding stable: it is also part of existing SecureStore keys. */
export function localNarraGatewayScope(baseUrl: string): string | undefined {
  const url = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(url.hostname)) return;
  const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return Array.from(endpoint, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
