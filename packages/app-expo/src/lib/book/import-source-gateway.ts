import { narraGatewayRequest } from "../ai/narra-gateway-fetch";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return input.toString();
}

export async function gatewayImportSourceFetch(
  input: RequestInfo | URL,
  _init?: RequestInit,
): Promise<Response> {
  const sourceUrl = requestUrl(input);
  return narraGatewayRequest(`/v2/import/fetch?url=${encodeURIComponent(sourceUrl)}`, {
    method: "GET",
  });
}
