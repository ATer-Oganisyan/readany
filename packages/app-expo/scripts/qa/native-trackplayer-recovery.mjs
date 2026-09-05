// Executes actual Kotlin lifecycle methods against deterministic platform ports.
// This is not Android framework acceptance and never modifies node_modules/device.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "narra-rntp-kotlin-"));
const relative = "android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt";
let source = readFileSync(join(root, "node_modules/react-native-track-player", relative), "utf8");
if (process.argv.includes("--candidate")) {
  const target = join(temp, relative);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, source);
  const candidate = join(root, "patches/react-native-track-player@4.1.2.patch");
  // Works both before and after installing the candidate; never undo an unknown patch.
  let candidateAlreadyInstalled = false;
  try {
    execFileSync("git", ["apply", "--reverse", "--check", `--include=${relative}`, candidate], {
      cwd: temp,
      stdio: "pipe",
    });
    candidateAlreadyInstalled = true;
  } catch {}
  if (!candidateAlreadyInstalled) {
    const baselineRef =
      process.env.READANY_RNTP_BASELINE_REF || "cebbc7f12872961285eea4171b82cd2fd448ded9";
    const baseline = execFileSync(
      "git",
      ["show", `${baselineRef}:patches/react-native-track-player@4.1.2.patch`],
      { cwd: root },
    );
    execFileSync("git", ["apply", "--reverse", `--include=${relative}`, "-"], {
      cwd: temp,
      input: baseline,
    });
    execFileSync("git", ["apply", `--include=${relative}`, candidate], { cwd: temp });
  }
  source = readFileSync(target, "utf8");
}
function method(name) {
  const match = new RegExp(`(?:override |private )?fun ${name}\\(`).exec(source);
  if (!match) throw new Error(`Missing actual method ${name}`);
  const start = match.index;
  const body = source.indexOf("{", start);
  let depth = 1;
  let end = body + 1;
  // Selected methods contain no braces inside literals; compile failure is loud.
  while (depth && end < source.length) {
    const char = source[end++];
    if (char === "{") depth++;
    if (char === "}") depth--;
  }
  if (depth) throw new Error(`Unterminated ${name}`);
  return source.slice(start, end);
}
const fields = source
  .split("\n")
  .filter((line) =>
    /^ {4}private var (serviceDestroyed|reactHostStartGeneration|cancelPendingReactHostStart|taskReactContext)/.test(
      line,
    ),
  )
  .join("\n");
const methods = ["onStartCommand", "startTaskWithReactHost", "invokeStartTask", "onDestroy"]
  .map(method)
  .join("\n");
const kotlin = readFileSync(new URL("./native-trackplayer-recovery.kt", import.meta.url), "utf8")
  .replace("// ACTUAL_FIELDS", fields)
  .replace("// ACTUAL_METHODS", methods);
writeFileSync(join(temp, "Recovery.kt"), kotlin);
const cache = join(homedir(), ".gradle/caches/modules-2/files-2.1");
function artifact(group, name, version) {
  const base = join(cache, group, name, version);
  for (const hash of readdirSync(base)) {
    const file = readdirSync(join(base, hash)).find((item) => item === `${name}-${version}.jar`);
    if (file) return join(base, hash, file);
  }
  throw new Error(`Missing cached Kotlin dependency ${name}`);
}
const stdlib = artifact("org.jetbrains.kotlin", "kotlin-stdlib", "2.0.21");
const annotations = artifact("org.jetbrains", "annotations", "13.0");
const jars = [
  artifact("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.0.21"),
  stdlib,
  annotations,
  artifact("org.jetbrains.kotlin", "kotlin-script-runtime", "2.0.21"),
  artifact("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
  artifact("org.jetbrains.intellij.deps", "trove4j", "1.0.20200330"),
  artifact("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.6.4"),
];
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin/java")
  : "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java";
console.log(
  JSON.stringify({
    mode: process.argv.includes("--candidate") ? "candidate" : "installed",
    temp,
  }),
);
execFileSync(
  java,
  [
    "-cp",
    jars.join(":"),
    "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
    "-no-stdlib",
    "-no-reflect",
    "-classpath",
    [stdlib, annotations].join(":"),
    "-d",
    join(temp, "classes"),
    join(temp, "Recovery.kt"),
  ],
  { stdio: "inherit" },
);
execFileSync(java, ["-cp", [join(temp, "classes"), stdlib].join(":"), "RecoveryKt"], {
  stdio: "inherit",
});
