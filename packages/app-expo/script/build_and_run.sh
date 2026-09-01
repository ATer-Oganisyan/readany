#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-simulator}"
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONOREPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"

SIMULATOR_NAME="${READANY_SIMULATOR_NAME:-iPhone 17 Pro}"
SIMULATOR_ID="${READANY_SIMULATOR_ID:-}"
METRO_PORT="${READANY_METRO_PORT:-8081}"
NARRA_BACKEND_PROFILE="${READANY_NARRA_BACKEND:-}"

case "$NARRA_BACKEND_PROFILE" in
  "")
    export EXPO_PUBLIC_NARRA_ENVIRONMENT="${EXPO_PUBLIC_NARRA_ENVIRONMENT:-test}"
    export EXPO_PUBLIC_NARRA_GATEWAY_URL="${EXPO_PUBLIC_NARRA_GATEWAY_URL:-https://api-test.narra.disrupt.builders}"
    ;;
  test)
    export EXPO_PUBLIC_NARRA_ENVIRONMENT="test"
    export EXPO_PUBLIC_NARRA_GATEWAY_URL="https://api-test.narra.disrupt.builders"
    ;;
  production|prod)
    export EXPO_PUBLIC_NARRA_ENVIRONMENT="production"
    export EXPO_PUBLIC_NARRA_GATEWAY_URL="https://api.narra.disrupt.builders"
    ;;
  *)
    printf '[Narra iOS] ERROR: Unsupported READANY_NARRA_BACKEND: %s\n' "$NARRA_BACKEND_PROFILE" >&2
    exit 2
    ;;
esac
export EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE="${EXPO_PUBLIC_NARRA_GATEWAY_AUTH_MODE:-installation}"
BUNDLE_ID="com.mishanaer.readany.dev"
if [[ -d "$APP_ROOT/ios/ReadAnyDev.xcworkspace" ]]; then
  WORKSPACE="$APP_ROOT/ios/ReadAnyDev.xcworkspace"
  SCHEME="ReadAnyDev"
elif [[ -d "$APP_ROOT/ios/ReadAny.xcworkspace" ]]; then
  WORKSPACE="$APP_ROOT/ios/ReadAny.xcworkspace"
  SCHEME="ReadAny"
else
  WORKSPACE="$APP_ROOT/ios/Narra.xcworkspace"
  SCHEME="Narra"
fi
DERIVED_DATA_PATH="${READANY_DERIVED_DATA_PATH:-$APP_ROOT/ios/build/codex-devicehub}"
CANONICAL_APP="$DERIVED_DATA_PATH/Build/Products/Debug-iphonesimulator/Narra.app"
FINGERPRINT_FILE="$DERIVED_DATA_PATH/.readany-native-fingerprint"
XCODE_APP_PATH=""
SIMULATOR_UI_APP=""
SIMULATOR_UI_EXECUTABLE=""
SIMULATOR_UI_NAME=""

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
  simulator, run   Boot Simulator, reuse/start Metro, and launch the installed dev client
  start            Start Metro on localhost for the installed Simulator dev client
  start-lan        Start Metro on LAN for a physical phone
  rebuild-ios      Build/install the canonical iOS dev client, then launch it
  ios, --ios       Legacy alias for rebuild-ios
  check, --check   Check launch prerequisites and canonical build status
  help, --help     Show this help

Optional environment variables:
  READANY_SIMULATOR_NAME       Simulator name (default: iPhone 17 Pro)
  READANY_SIMULATOR_ID         Exact simulator UDID (takes precedence over name)
  READANY_METRO_PORT           Metro port (default: 8081)
  READANY_NARRA_BACKEND        Backend profile: test (default) or production
  READANY_DERIVED_DATA_PATH    Canonical DerivedData directory
  READANY_DEVELOPER_DIR        Xcode Developer directory (defaults to DEVELOPER_DIR or xcode-select)
  READANY_ALLOW_PASTEBOARD_SYNC=1
                               Allow automatic Simulator pasteboard sync intentionally
  EXPO_PUBLIC_NARRA_GATEWAY_URL
                               Custom dev gateway URL when READANY_NARRA_BACKEND is unset

The simulator mode never runs xcodebuild, expo run:ios, prebuild, pod install, or a tunnel.
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

resolve_developer_toolchain() {
  local selected_developer_dir="${READANY_DEVELOPER_DIR:-${DEVELOPER_DIR:-}}"

  if [[ -z "$selected_developer_dir" ]]; then
    selected_developer_dir="$(xcode-select -p)"
  fi
  selected_developer_dir="${selected_developer_dir%/}"

  [[ -d "$selected_developer_dir" ]] \
    || die "Xcode Developer directory is missing: $selected_developer_dir"

  case "$selected_developer_dir" in
    */Contents/Developer)
      XCODE_APP_PATH="${selected_developer_dir%/Contents/Developer}"
      ;;
    *)
      die "Expected an Xcode Developer directory ending in /Contents/Developer, got: $selected_developer_dir"
      ;;
  esac

  export DEVELOPER_DIR="$selected_developer_dir"

  if [[ -d "$XCODE_APP_PATH/Contents/Applications/DeviceHub.app" ]]; then
    SIMULATOR_UI_APP="$XCODE_APP_PATH/Contents/Applications/DeviceHub.app"
    SIMULATOR_UI_EXECUTABLE="$SIMULATOR_UI_APP/Contents/MacOS/DeviceHub"
    SIMULATOR_UI_NAME="Device Hub"
  elif [[ -d "$DEVELOPER_DIR/Applications/Simulator.app" ]]; then
    SIMULATOR_UI_APP="$DEVELOPER_DIR/Applications/Simulator.app"
    SIMULATOR_UI_EXECUTABLE="$SIMULATOR_UI_APP/Contents/MacOS/Simulator"
    SIMULATOR_UI_NAME="Simulator"
  else
    die "Neither Device Hub nor Simulator was found inside $XCODE_APP_PATH"
  fi
}

running_simulator_ui_processes() {
  ps -axo pid=,command= | while IFS= read -r process_line; do
    case "$process_line" in
      *"/Simulator.app/Contents/MacOS/Simulator"*|*"/DeviceHub.app/Contents/MacOS/DeviceHub"*)
        printf '%s\n' "$process_line"
        ;;
    esac
  done
}

assert_simulator_ui_matches_toolchain() {
  local process_line
  local conflicts=""

  while IFS= read -r process_line; do
    [[ -n "$process_line" ]] || continue
    if [[ "$process_line" != *"$SIMULATOR_UI_EXECUTABLE"* ]]; then
      conflicts+="${conflicts:+; }$process_line"
    fi
  done < <(running_simulator_ui_processes)

  if [[ -n "$conflicts" ]]; then
    die "Simulator UI from another Xcode is running ($conflicts). Expected $SIMULATOR_UI_EXECUTABLE. Quit Simulator and Device Hub, then rerun."
  fi
}

pasteboard_sync_status() {
  defaults read com.apple.iphonesimulator PasteboardAutomaticSync 2>/dev/null || printf 'unset'
}

assert_pasteboard_sync_is_safe() {
  local status
  status="$(pasteboard_sync_status)"

  case "$status" in
    0|false|FALSE|NO)
      return
      ;;
  esac

  if [[ "${READANY_ALLOW_PASTEBOARD_SYNC:-0}" == "1" ]]; then
    log "Automatic Simulator pasteboard sync is not confirmed off (status: $status); continuing by explicit override"
    return
  fi

  die "Automatic Simulator pasteboard sync is not confirmed off (status: $status) and can freeze the Mac clipboard. Disable Edit > Automatically Sync Pasteboard, or set READANY_ALLOW_PASTEBOARD_SYNC=1 for an intentional one-off test."
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
  require_command defaults
  require_command ps
  require_command xcode-select

  resolve_developer_toolchain

  [[ -d "$WORKSPACE" ]] || die "Xcode workspace is missing: $WORKSPACE"
  [[ -f "$APP_ROOT/ios/Podfile.lock" ]] || die "ios/Podfile.lock is missing. Do not run prebuild automatically."
  [[ -f "$APP_ROOT/ios/Pods/Manifest.lock" ]] || die "Pods are missing. Restore the main checkout Pods before building."

  if ! cmp -s "$APP_ROOT/ios/Podfile.lock" "$APP_ROOT/ios/Pods/Manifest.lock"; then
    die "Pods are out of sync with Podfile.lock. Run pod install intentionally before rebuilding."
  fi
}

check_simulator_prerequisites() {
  require_command pnpm
  require_command node
  require_command curl
  require_command xcrun
  require_command plutil
  require_command shasum
  require_command open
  require_command defaults
  require_command ps
  require_command xcode-select

  resolve_developer_toolchain
}

prepare_development_variant() {
  log "Preparing reader assets and the development native variant"
  (
    cd "$APP_ROOT"
    pnpm run build:reader
    APP_VARIANT=development node scripts/configure-native-variant.js
  )
}

ensure_reader_asset() {
  log "Preparing current reader assets (unchanged files are preserved)"
  (
    cd "$APP_ROOT"
    pnpm run build:reader
  )
}

metro_is_running() {
  curl --silent --fail --max-time 1 "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null \
    | grep -q 'packager-status:running'
}

run_metro_prepared() {
  local host_mode="${1:-localhost}"
  local host_args=(--localhost)

  if [[ "$host_mode" == "lan" ]]; then
    host_args=(--lan)
    log "Starting Metro on LAN:$METRO_PORT"
  else
    log "Starting Metro on localhost:$METRO_PORT"
  fi
  log "Gateway profile: $EXPO_PUBLIC_NARRA_ENVIRONMENT ($EXPO_PUBLIC_NARRA_GATEWAY_URL)"

  cd "$APP_ROOT"
  # Keep reader dependencies in the initial bundle: an import() must not need
  # another Metro request after the dev server disconnects or the app resumes.
  APP_VARIANT=development \
    EXPO_NO_METRO_LAZY=1 \
    NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" \
    pnpm exec expo start --dev-client --scheme readany-dev "${host_args[@]}" --port "$METRO_PORT"
}

run_metro() {
  ensure_reader_asset
  run_metro_prepared localhost
}

run_metro_lan() {
  ensure_reader_asset
  run_metro_prepared lan
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
      "$APP_ROOT/ios/ReadAnyDev.xcodeproj/project.pbxproj" \
      "$APP_ROOT/ios/ReadAny.xcodeproj/project.pbxproj" \
      "$APP_ROOT/ios/Narra.xcodeproj/project.pbxproj" \
      "$MONOREPO_ROOT/node_modules/expo-dev-launcher/package.json" \
      "$MONOREPO_ROOT/node_modules/expo-dev-launcher/ios/ReactNative/EXDevLauncherRCTDevSettings.m"; do
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
  if [[ "$SIMULATOR_UI_NAME" == "Device Hub" ]]; then
    log "Opening Device Hub from the selected Xcode"
    open -a "$SIMULATOR_UI_APP" "devices://device/open?id=$SIMULATOR_ID"
  else
    log "Opening Simulator from the selected Xcode"
    open -a "$SIMULATOR_UI_APP" --args -CurrentDeviceUDID "$SIMULATOR_ID"
  fi

  log "Launching $BUNDLE_ID"
  xcrun simctl launch --terminate-running-process "$SIMULATOR_ID" "$BUNDLE_ID"
  open_dev_client_url
}

dev_client_url() {
  curl --silent --fail --max-time 15 \
    "http://127.0.0.1:$METRO_PORT/_expo/open?platform=ios&runtime=custom" \
    | node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const payload = JSON.parse(input);
          if (payload.url) process.stdout.write(payload.url);
        } catch {}
      });
    '
}

open_dev_client_url() {
  local url=""
  url="$(dev_client_url 2>/dev/null || true)"

  if [[ -z "$url" ]]; then
    log "Metro open endpoint is unavailable; relying on dev-client most-recent"
    return
  fi

  log "Opening dev client URL from Metro"
  xcrun simctl openurl "$SIMULATOR_ID" "$url" >/dev/null
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

check_installed_dev_client() {
  local expected_build
  local installed_path
  local installed_build=""
  local saved_fingerprint=""
  local current_fingerprint=""

  expected_build="$(expected_build_number)"
  installed_path="$(installed_app_path)"

  if [[ -z "$installed_path" ]]; then
    die "Development client is not installed on $SIMULATOR_NAME. Run './script/build_and_run.sh rebuild-ios' explicitly."
  fi

  installed_build="$(app_build_number "$installed_path")"
  if [[ "$installed_build" != "$expected_build" ]]; then
    die "Installed dev client build is $installed_build, expected $expected_build. Run './script/build_and_run.sh rebuild-ios' explicitly."
  fi

  if [[ -f "$FINGERPRINT_FILE" && -d "$CANONICAL_APP" ]]; then
    saved_fingerprint="$(<"$FINGERPRINT_FILE")"
    current_fingerprint="$(native_fingerprint)"
    if [[ "$saved_fingerprint" != "$current_fingerprint" ]]; then
      die "Native fingerprint changed. Run './script/build_and_run.sh rebuild-ios' explicitly."
    fi
  else
    log "Canonical build metadata is not initialized; using the installed build $installed_build without rebuilding"
  fi

  log "Installed development client is ready: build $installed_build"
}

run_simulator() {
  local launcher_pid=""

  check_simulator_prerequisites
  assert_simulator_ui_matches_toolchain
  assert_pasteboard_sync_is_safe
  resolve_simulator_id
  boot_simulator
  check_installed_dev_client
  ensure_reader_asset

  if metro_is_running; then
    log "Reusing Metro on port $METRO_PORT"
    launch_app
    return
  fi

  launch_when_metro_is_ready &
  launcher_pid=$!
  trap '[[ -n "${launcher_pid:-}" ]] && kill "$launcher_pid" >/dev/null 2>&1 || true' EXIT INT TERM
  run_metro
}

run_rebuild_ios() {
  local expected_build
  local current_fingerprint
  local launcher_pid=""

  check_common_prerequisites
  assert_simulator_ui_matches_toolchain
  assert_pasteboard_sync_is_safe
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
  run_metro_prepared localhost
}

run_check() {
  local expected_build
  local installed_path
  local installed_build="not installed"
  local metro_status="stopped"
  local canonical_status="missing"
  local fingerprint_status="missing"
  local saved_fingerprint=""
  local current_fingerprint=""

  check_common_prerequisites
  assert_simulator_ui_matches_toolchain
  assert_pasteboard_sync_is_safe
  resolve_simulator_id
  expected_build="$(expected_build_number)"
  installed_path="$(installed_app_path)"
  [[ -n "$installed_path" ]] && installed_build="$(app_build_number "$installed_path")"
  metro_is_running && metro_status="running"

  if [[ -d "$CANONICAL_APP" ]]; then
    canonical_status="build $(app_build_number "$CANONICAL_APP")"
  fi

  if [[ -f "$FINGERPRINT_FILE" ]]; then
    saved_fingerprint="$(<"$FINGERPRINT_FILE")"
    current_fingerprint="$(native_fingerprint)"
    if [[ "$saved_fingerprint" == "$current_fingerprint" ]]; then
      fingerprint_status="current"
    else
      fingerprint_status="changed; rebuild required"
    fi
  fi

  log "Xcode: $(xcodebuild -version | tr '\n' ' ')"
  log "Developer directory: $DEVELOPER_DIR"
  log "Simulator UI: $SIMULATOR_UI_NAME ($SIMULATOR_UI_APP)"
  log "Automatic pasteboard sync: $(pasteboard_sync_status)"
  log "Simulator: $SIMULATOR_NAME ($SIMULATOR_ID)"
  log "Expected build: $expected_build; installed build: $installed_build"
  log "Metro localhost:$METRO_PORT: $metro_status"
  log "Workspace: $WORKSPACE"
  log "Canonical DerivedData: $DERIVED_DATA_PATH"
  log "Canonical app: $canonical_status"
  log "Native fingerprint: $fingerprint_status"
}

case "$MODE" in
  simulator|run)
    run_simulator
    ;;
  start)
    run_metro
    ;;
  start-lan|lan)
    run_metro_lan
    ;;
  rebuild-ios|rebuild|ios|--ios)
    run_rebuild_ios
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
