export const TEST_NARRA_GATEWAY_URL = "https://api-test.narra.disrupt.builders";
export const PRODUCTION_NARRA_GATEWAY_URL = "https://api.narra.disrupt.builders";

/** One effective profile for transport, credential/cache namespaces and diagnostics. */
export function getEffectiveNarraGatewayProfile(): {
  baseUrl: string;
  authMode: "none" | "installation";
  environment: string;
} {
  // Reserved launcher values are never stored in dotenv. Expo's dev virtual/env
  // merges dotenv above ordinary process env, so ordinary keys cannot carry overrides.
  const launchUrl = process.env.EXPO_PUBLIC_NARRA_LAUNCH_GATEWAY_URL;
  const launchEnvironment = process.env.EXPO_PUBLIC_NARRA_LAUNCH_ENVIRONMENT;
  const launchAuth = process.env.EXPO_PUBLIC_NARRA_LAUNCH_AUTH_MODE;
  if (launchUrl !== undefined || launchEnvironment !== undefined || launchAuth !== undefined) {
    const baseUrl = launchUrl?.trim().replace(/\/+$/, "");
    if (
      !baseUrl ||
      !launchEnvironment ||
      !["development", "test", "staging", "production"].includes(launchEnvironment)
    ) {
      throw new Error("NARRA_LAUNCH_PROFILE_INVALID");
    }
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error("NARRA_LAUNCH_PROFILE_INVALID");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (launchEnvironment === "production" && baseUrl !== PRODUCTION_NARRA_GATEWAY_URL) ||
      (launchAuth !== undefined && launchAuth !== "none" && launchAuth !== "installation")
    ) {
      throw new Error("NARRA_LAUNCH_PROFILE_INVALID");
    }
    return {
      baseUrl,
      environment: launchEnvironment,
      authMode: launchAuth === "none" ? "none" : "installation",
    };
  }
  const environment = process.env.EXPO_PUBLIC_NARRA_ENVIRONMENT ?? "unknown";
  const configuredUrl = process.env.EXPO_PUBLIC_NARRA_GATEWAY_URL?.trim().replace(/\/+$/, "");
  return {
    environment,
    baseUrl:
      environment === "production"
        ? PRODUCTION_NARRA_GATEWAY_URL
        : configuredUrl || TEST_NARRA_GATEWAY_URL,
    authMode: process.env.EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE === "none" ? "none" : "installation",
  };
}
