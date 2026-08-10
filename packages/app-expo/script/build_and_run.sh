#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-start}"
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONOREPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"

SIMULATOR_NAME="${READANY_SIMULATOR_NAME:-iPhone 17 Pro}"
SIMULATOR_ID="${READANY_SIMULATOR_ID:-}"
METRO_PORT="${READANY_METRO_PORT:-8081}"
BUNDLE_ID="com.mishanaer.readany.dev"
WORKSPACE="$APP_ROOT/ios/ReadAnyDev.xcworkspace"
SCHEME="ReadAnyDev"
DERIVED_DATA_PATH="${READANY_DERIVED_DATA_PATH:-$APP_ROOT/ios/build/codex-devicehub}"
CANONICAL_APP="$DERIVED_DATA_PATH/Build/Products/Debug-iphonesimulator/Narra.app"
FINGERPRINT_FILE="$DERIVED_DATA_PATH/.readany-native-fingerprint"

log() {
  printf '[Narra iOS] %s\n' "$*"
}

die() {
  printf '[Narra iOS] ERROR: %s\n' "$*" >&2
  exit 1
}

show_usage() {
  cat <<'USAGE'
usage: ./script/build_and_run.sh [mode]

Modes:
  start, run       Start Metro for the installed development client
  ios, --ios       Safely build if needed, install, start Metro, and open Device Hub
  check, --check   Check the local iOS launch prerequisites without changing anything
  help, --help     Show this help

Optional environment variables:
  READANY_SIMULATOR_NAME       Simulator name (default: iPhone 17 Pro)
  READANY_SIMULATOR_ID         Exact simulator UDID (takes precedence over name)
  READANY_METRO_PORT           Metro port (default: 8081)
  READANY_DERIVED_DATA_PATH    Canonical DerivedData directory

This script intentionally never uses expo run:ios, expo start --ios, or a tunnel.
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

check_common_prerequisites() {
  require_command pnpm
  require_command node
  require_command curl
  require_command shasum
  require_command xcodebuild
  require_command xcrun
  require_command plutil
  require_command open

  [[ -d "$WORKSPACE" ]] || die "Xcode workspace is missing: $WORKSPACE"
  [[ -f "$APP_ROOT/ios/Podfile.lock" ]] || die "ios/Podfile.lock is missing. Do not run prebuild automatically."
  [[ -f "$APP_ROOT/ios/Pods/Manifest.lock" ]] || die "Pods are missing. Restore the main checkout Pods before building."

  if ! cmp -s "$APP_ROOT/ios/Podfile.lock" "$APP_ROOT/ios/Pods/Manifest.lock"; then
    die "Pods are out of sync with Podfile.lock. Run pod install intentionally before rebuilding."
  fi
}

prepare_development_variant() {
  log "Preparing reader assets and the development native variant"
  (
    cd "$APP_ROOT"
    pnpm run build:reader
    APP_VARIANT=development node scripts/configure-native-variant.js
  )
}

metro_is_running() {
  curl --silent --fail --max-time 1 "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null \
    | grep -q 'packager-status:running'
}

run_metro_prepared() {
  log "Starting Metro on localhost:$METRO_PORT"
  cd "$APP_ROOT"
  EXPO_NO_METRO_LAZY=1 APP_VARIANT=development \
    NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" \
    pnpm exec expo start --dev-client --scheme readany-dev --localhost --port "$METRO_PORT"
}

run_metro() {
  prepare_development_variant
  run_metro_prepared
}

resolve_simulator_id() {
  local devices_json

  if [[ -n "$SIMULATOR_ID" ]]; then
    return
  fi

  if ! devices_json="$(xcrun simctl list devices available -j)"; then
    die "CoreSimulator is unavailable. Open Device Hub once and rerun Check iOS."
  fi

  SIMULATOR_ID="$(printf '%s' "$devices_json" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const requestedName = process.argv[1];
      const payload = JSON.parse(input);
      const devices = Object.values(payload.devices || {}).flat();
      const matches = devices.filter(device => device.isAvailable && device.name === requestedName);
      const selected = matches.find(device => device.state === "Booted") || matches[0];
      if (selected?.udid) process.stdout.write(selected.udid);
    });
  ' "$SIMULATOR_NAME")"

  [[ -n "$SIMULATOR_ID" ]] || die "Available simulator not found: $SIMULATOR_NAME"
}

boot_simulator() {
  xcrun simctl boot "$SIMULATOR_ID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$SIMULATOR_ID" -b
}

expected_build_number() {
  (
    cd "$APP_ROOT"
    APP_VARIANT=development node -e \
      'process.stdout.write(String(require("./app.config.js").expo.ios.buildNumber))'
  )
}

plist_value() {
  local plist_path="$1"
  local key="$2"
  plutil -extract "$key" raw -o - "$plist_path" 2>/dev/null || true
}

app_build_number() {
  local app_path="$1"
  [[ -f "$app_path/Info.plist" ]] || return 0
  plist_value "$app_path/Info.plist" CFBundleVersion
}

app_binary_hash() {
  local app_path="$1"
  local executable
  local binary_path

  [[ -f "$app_path/Info.plist" ]] || return 0
  executable="$(plist_value "$app_path/Info.plist" CFBundleExecutable)"
  [[ -n "$executable" ]] || return 0

  if [[ -f "$app_path/$executable.debug.dylib" ]]; then
    binary_path="$app_path/$executable.debug.dylib"
  elif [[ -f "$app_path/$executable" ]]; then
    binary_path="$app_path/$executable"
  else
    return 0
  fi

  shasum -a 256 "$binary_path" | awk '{print $1}'
}

native_fingerprint() {
  {
    for path in \
      "$APP_ROOT/app.config.js" \
      "$APP_ROOT/package.json" \
      "$MONOREPO_ROOT/package.json" \
      "$MONOREPO_ROOT/pnpm-lock.yaml" \
      "$APP_ROOT/ios/Podfile" \
      "$APP_ROOT/ios/Podfile.lock" \
      "$APP_ROOT/ios/Podfile.properties.json" \
      "$APP_ROOT/ios/Pods/Manifest.lock" \
      "$APP_ROOT/ios/ReadAnyDev.xcodeproj/project.pbxproj"; do
      [[ -f "$path" ]] && printf '%s\n' "$path"
    done

    for directory in \
      "$APP_ROOT/modules" \
      "$APP_ROOT/plugins" \
      "$MONOREPO_ROOT/patches"; do
      [[ -d "$directory" ]] && find "$directory" -type f -print
    done

    find "$APP_ROOT/scripts" -maxdepth 1 -type f \
      \( -name 'app-variant*' -o -name 'configure-native-variant*' \) -print
    find "$APP_ROOT/ios/Pods/Local Podspecs" -type f -print 2>/dev/null || true
  } | LC_ALL=C sort | while IFS= read -r path; do
    shasum -a 256 "$path"
  done | shasum -a 256 | awk '{print $1}'
}

build_canonical_app_if_needed() {
  local expected_build="$1"
  local current_fingerprint="$2"
  local saved_fingerprint=""
  local canonical_build=""
  local needs_build=0

  [[ -f "$FINGERPRINT_FILE" ]] && saved_fingerprint="$(<"$FINGERPRINT_FILE")"
  canonical_build="$(app_build_number "$CANONICAL_APP")"

  if [[ "$saved_fingerprint" != "$current_fingerprint" ]]; then
    log "Native fingerprint changed; a fresh native build is required"
    needs_build=1
  elif [[ ! -d "$CANONICAL_APP" ]]; then
    log "Canonical app is missing; a fresh native build is required"
    needs_build=1
  elif [[ "$canonical_build" != "$expected_build" ]]; then
    log "Canonical build is $canonical_build, expected $expected_build"
    needs_build=1
  fi

  if [[ "$needs_build" -eq 0 ]]; then
    log "Canonical native build is current"
    return
  fi

  mkdir -p "$DERIVED_DATA_PATH"
  log "Building $SCHEME into the canonical DerivedData directory"
  APP_VARIANT=development xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    build

  [[ -d "$CANONICAL_APP" ]] || die "Build succeeded but canonical app was not found: $CANONICAL_APP"
  canonical_build="$(app_build_number "$CANONICAL_APP")"
  [[ "$canonical_build" == "$expected_build" ]] \
    || die "Built app has build $canonical_build, expected $expected_build"

  printf '%s\n' "$current_fingerprint" >"$FINGERPRINT_FILE"
}

installed_app_path() {
  xcrun simctl get_app_container "$SIMULATOR_ID" "$BUNDLE_ID" app 2>/dev/null || true
}

install_canonical_app_if_needed() {
  local expected_build="$1"
  local installed_path
  local installed_build=""
  local installed_hash=""
  local canonical_hash=""

  installed_path="$(installed_app_path)"
  [[ -n "$installed_path" ]] && installed_build="$(app_build_number "$installed_path")"
  [[ -n "$installed_path" ]] && installed_hash="$(app_binary_hash "$installed_path")"
  canonical_hash="$(app_binary_hash "$CANONICAL_APP")"

  if [[ "$installed_build" == "$expected_build" \
    && -n "$canonical_hash" \
    && "$installed_hash" == "$canonical_hash" ]]; then
    log "Simulator already has the canonical build $expected_build"
    return
  fi

  log "Installing only the canonical app: $CANONICAL_APP"
  xcrun simctl install "$SIMULATOR_ID" "$CANONICAL_APP"
}

launch_app() {
  log "Opening Device Hub for $SIMULATOR_NAME"
  open "devices://device/open?id=$SIMULATOR_ID"
  log "Launching $BUNDLE_ID"
  xcrun simctl launch --terminate-running-process "$SIMULATOR_ID" "$BUNDLE_ID"
}

launch_when_metro_is_ready() {
  local attempt
  for attempt in $(seq 1 120); do
    if metro_is_running; then
      launch_app
      return 0
    fi
    sleep 1
  done
  die "Metro did not become ready on port $METRO_PORT within 120 seconds"
}

run_ios() {
  local expected_build
  local current_fingerprint
  local launcher_pid=""

  check_common_prerequisites
  prepare_development_variant
  resolve_simulator_id
  boot_simulator

  expected_build="$(expected_build_number)"
  current_fingerprint="$(native_fingerprint)"
  log "Expected build: $expected_build; native fingerprint: ${current_fingerprint:0:12}"

  build_canonical_app_if_needed "$expected_build" "$current_fingerprint"
  install_canonical_app_if_needed "$expected_build"

  if metro_is_running; then
    log "Reusing Metro on port $METRO_PORT"
    launch_app
    return
  fi

  launch_when_metro_is_ready &
  launcher_pid=$!
  trap '[[ -n "${launcher_pid:-}" ]] && kill "$launcher_pid" >/dev/null 2>&1 || true' EXIT INT TERM
  run_metro_prepared
}

run_check() {
  local expected_build
  local installed_path
  local installed_build="not installed"
  local metro_status="stopped"

  check_common_prerequisites
  resolve_simulator_id
  expected_build="$(expected_build_number)"
  installed_path="$(installed_app_path)"
  [[ -n "$installed_path" ]] && installed_build="$(app_build_number "$installed_path")"
  metro_is_running && metro_status="running"

  log "Xcode: $(xcodebuild -version | tr '\n' ' ')"
  log "Simulator: $SIMULATOR_NAME ($SIMULATOR_ID)"
  log "Expected build: $expected_build; installed build: $installed_build"
  log "Metro localhost:$METRO_PORT: $metro_status"
  log "Workspace: $WORKSPACE"
  log "Canonical DerivedData: $DERIVED_DATA_PATH"
}

case "$MODE" in
  start|run)
    run_metro
    ;;
  ios|--ios)
    run_ios
    ;;
  check|--check)
    run_check
    ;;
  help|--help|-h)
    show_usage
    ;;
  *)
    show_usage >&2
    exit 2
    ;;
esac
