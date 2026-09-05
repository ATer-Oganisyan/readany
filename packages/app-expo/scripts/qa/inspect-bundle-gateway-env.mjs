// Execute only the downloaded dev bundle's public-env modules, never app code.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundle = readFileSync(process.argv[2], "utf8");
const registered = new Map();
const sourceModules = new Map();
for (const chunk of bundle.split("\n__d(")) {
  const tail = chunk.match(/\n\},(\d+),\[[^\n]*\],("[^\n]*")\);/);
  if (!tail) continue;
  const name = JSON.parse(tail[2]);
  if (!name.endsWith("expo/virtual/env.js") && !name.endsWith("src/lib/ai/narra-gateway-config.ts") && !name.includes("?ctx=") && !name.startsWith(".env")) continue;
  sourceModules.set(Number(tail[1]), {name, source:`__d(${chunk.slice(0,tail.index + tail[0].length)}`});
}
const context = vm.createContext({URL,process:{env:{}},__d:(factory,id,deps,name) => registered.set(id,{factory,deps,name})});
const injected = bundle.match(/\/\* HMR env vars from Expo CLI \(dev-only\) \*\/ ([^\n]+)/)?.[1];
if (!injected) throw new Error("Missing Expo public process env injection");
vm.runInContext(injected,context,{timeout:1000});
for (const entry of sourceModules.values()) vm.runInContext(entry.source,context,{timeout:1000});
const loaded = new Map();
function requireEnv(id) {
  if (loaded.has(id)) return loaded.get(id).exports;
  const entry = registered.get(id);
  if (!entry) throw new Error(`Refusing non-env module ${id}`);
  const module={exports:{}};
  loaded.set(id,module);
  entry.factory(context,requireEnv,null,null,module,module.exports,entry.deps);
  return module.exports;
}
const selected = [...registered].filter(([,entry])=>entry.name.endsWith("expo/virtual/env.js"));
if (selected.length !== 1) throw new Error("Expected one virtual/env module");
const env = requireEnv(selected[0][0]).env;
const profiles = [...registered].filter(([,entry])=>entry.name.endsWith("src/lib/ai/narra-gateway-config.ts"));
const effectiveProfile = profiles.length === 1 ? requireEnv(profiles[0][0]).getEffectiveNarraGatewayProfile() : undefined;
console.log(JSON.stringify({
  processGateway:context.process.env.EXPO_PUBLIC_NARRA_GATEWAY_URL,
  virtualGateway:env.EXPO_PUBLIC_NARRA_GATEWAY_URL,
  virtualEnvironment:env.EXPO_PUBLIC_NARRA_ENVIRONMENT,
  effectiveProfile,
  executedModules:[...loaded.keys()].map(id=>registered.get(id).name),
},null,2));
