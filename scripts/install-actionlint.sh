#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly ACTIONLINT_VERSION='1.7.7'
readonly CACHE_DIR="$ROOT_DIR/.cache/tools/actionlint/$ACTIONLINT_VERSION"
readonly BINARY_PATH="$CACHE_DIR/actionlint"
readonly CHECKSUM_PATH="$CACHE_DIR/archive.sha256"
readonly BINARY_CHECKSUM_PATH="$CACHE_DIR/binary.sha256"

TEMP_DIR=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

fail() {
  printf 'ACTIONLINT_INSTALL_FAILED code=%s\n' "$1" >&2
  exit 1
}

environment_blocked() {
  printf 'ENVIRONMENT_BLOCKED component=actionlint reason=%s\n' "$1" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || environment_blocked "command-unavailable-$1"
}

platform_archive() {
  local os="$1"
  local arch="$2"
  case "$os/$arch" in
    linux/386)
      printf 'actionlint_1.7.7_linux_386.tar.gz\n'
      ;;
    linux/amd64)
      printf 'actionlint_1.7.7_linux_amd64.tar.gz\n'
      ;;
    linux/arm64)
      printf 'actionlint_1.7.7_linux_arm64.tar.gz\n'
      ;;
    linux/armv6)
      printf 'actionlint_1.7.7_linux_armv6.tar.gz\n'
      ;;
    darwin/amd64)
      printf 'actionlint_1.7.7_darwin_amd64.tar.gz\n'
      ;;
    darwin/arm64)
      printf 'actionlint_1.7.7_darwin_arm64.tar.gz\n'
      ;;
    freebsd/386)
      printf 'actionlint_1.7.7_freebsd_386.tar.gz\n'
      ;;
    freebsd/amd64)
      printf 'actionlint_1.7.7_freebsd_amd64.tar.gz\n'
      ;;
    windows/386)
      printf 'actionlint_1.7.7_windows_386.zip\n'
      ;;
    windows/amd64)
      printf 'actionlint_1.7.7_windows_amd64.zip\n'
      ;;
    windows/arm64)
      printf 'actionlint_1.7.7_windows_arm64.zip\n'
      ;;
    *)
      environment_blocked "unsupported-platform-$os-$arch"
      ;;
  esac
}

archive_binary_name() {
  case "$1" in
    *.zip) printf 'actionlint.exe\n' ;;
    *) printf 'actionlint\n' ;;
  esac
}

expected_checksum() {
  local archive="$1"
  case "$archive" in
    actionlint_1.7.7_darwin_amd64.tar.gz)
      printf '28e5de5a05fc558474f638323d736d822fff183d2d492f0aecb2b73cc44584f5\n'
      ;;
    actionlint_1.7.7_darwin_arm64.tar.gz)
      printf '2693315b9093aeacb4ebd91a993fea54fc215057bf0da2659056b4bc033873db\n'
      ;;
    actionlint_1.7.7_freebsd_386.tar.gz)
      printf 'a6ee742126aa632b32009bdd6f820e0274c5b24536dc302a9574118378ee92f4\n'
      ;;
    actionlint_1.7.7_freebsd_amd64.tar.gz)
      printf 'f6eec0e5efd17183a954f0d88280885b7a58f39808050cdfcd7f068fc1734bc8\n'
      ;;
    actionlint_1.7.7_linux_386.tar.gz)
      printf '01d4c173f411aeecf670d5219c008e07bf11539cf1181fdeee0cdb0eb8244aac\n'
      ;;
    actionlint_1.7.7_linux_amd64.tar.gz)
      printf '023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757\n'
      ;;
    actionlint_1.7.7_linux_arm64.tar.gz)
      printf '401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0\n'
      ;;
    actionlint_1.7.7_linux_armv6.tar.gz)
      printf '82e98d7252341b83fa557764824f225fa50431801b8e3d8e99f70dc1efc317b2\n'
      ;;
    actionlint_1.7.7_windows_386.zip)
      printf '66de2b65bcee17de1866287a513cadf47d812229e976e99024e9757645258adb\n'
      ;;
    actionlint_1.7.7_windows_amd64.zip)
      printf '7f12f1801bca3d480d67aaf7774f4c2a6359a3ca8eebe382c95c10c9704aa731\n'
      ;;
    actionlint_1.7.7_windows_arm64.zip)
      printf '76e9514cfac18e5677aa04f3a89873c981f16a2f2353bb97372a86cd09b1f5a8\n'
      ;;
    *)
      fail "missing-checksum-$archive"
      ;;
  esac
}

detect_os() {
  case "$(uname -s)" in
    Linux) printf 'linux\n' ;;
    Darwin) printf 'darwin\n' ;;
    FreeBSD) printf 'freebsd\n' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'windows\n' ;;
    *) environment_blocked "unsupported-os-$(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    armv6l) printf 'armv6\n' ;;
    i386|i686|x86) printf '386\n' ;;
    *) environment_blocked "unsupported-arch-$(uname -m)" ;;
  esac
}

verify_archive() {
  local archive_path="$1"
  local expected="$2"
  local actual

  [[ -f "$archive_path" ]] || return 1
  actual="$(sha256sum "$archive_path" | awk '{ print $1 }')"
  if [[ "$actual" != "$expected" ]]; then
    printf 'ACTIONLINT_CHECKSUM_MISMATCH expected=%s actual=%s\n' "$expected" "$actual" >&2
    return 1
  fi
  return 0
}

extract_archive() {
  local archive_path="$1"
  local archive="$2"
  local destination="$3"

  case "$archive" in
    *.tar.gz)
      tar -xzf "$archive_path" -C "$destination"
      ;;
    *.zip)
      require_command unzip
      unzip -q "$archive_path" -d "$destination"
      ;;
    *)
      fail "unsupported-archive-$archive"
      ;;
  esac
}

verify_binary_cache() {
  local expected_archive_checksum="$1"
  local archive_path="$2"
  local archive="$3"
  local binary_name="$4"
  local stored_archive_checksum=""
  local stored_binary_checksum=""
  local actual_binary_checksum=""
  local expected_binary_checksum=""
  local check_dir="$TEMP_DIR/cache-check"
  local extracted_binary="$check_dir/$binary_name"

  [[ -x "$BINARY_PATH" && -f "$archive_path" && -f "$CHECKSUM_PATH" && -f "$BINARY_CHECKSUM_PATH" ]] || return 1
  stored_archive_checksum="$(tr -d '[:space:]' < "$CHECKSUM_PATH")"
  [[ "$stored_archive_checksum" == "$expected_archive_checksum" ]] || return 1
  verify_archive "$archive_path" "$expected_archive_checksum" || return 1

  rm -rf -- "$check_dir"
  mkdir -p -- "$check_dir"
  extract_archive "$archive_path" "$archive" "$check_dir"
  [[ -f "$extracted_binary" ]] || return 1
  expected_binary_checksum="$(sha256sum "$extracted_binary" | awk '{ print $1 }')"
  stored_binary_checksum="$(tr -d '[:space:]' < "$BINARY_CHECKSUM_PATH")"
  actual_binary_checksum="$(sha256sum "$BINARY_PATH" | awk '{ print $1 }')"
  [[ "$stored_binary_checksum" == "$expected_binary_checksum" ]] || return 1
  [[ "$actual_binary_checksum" == "$expected_binary_checksum" ]] || return 1
  "$BINARY_PATH" -version >/dev/null 2>&1 || return 1
  return 0
}

install_from_archive() {
  local archive_path="$1"
  local archive="$2"
  local binary_name="$3"
  local extract_dir="$TEMP_DIR/extracted"
  local extracted_binary="$extract_dir/$binary_name"
  local binary_checksum

  rm -rf -- "$extract_dir"
  mkdir -p -- "$extract_dir"
  extract_archive "$archive_path" "$archive" "$extract_dir"
  [[ -f "$extracted_binary" ]] || fail 'archive-missing-actionlint'
  install -m 0755 "$extracted_binary" "$BINARY_PATH"
  binary_checksum="$(sha256sum "$BINARY_PATH" | awk '{ print $1 }')"
  printf '%s\n' "$binary_checksum" > "$BINARY_CHECKSUM_PATH"
  "$BINARY_PATH" -version >/dev/null 2>&1 || fail 'installed-binary-failed-version-check'
}

main() {
  local os
  local arch
  local archive
  local binary_name
  local expected
  local archive_path
  local download_path
  local url

  require_command awk
  require_command curl
  require_command install
  require_command mkdir
  require_command mktemp
  require_command rm
  require_command sha256sum
  require_command tar
  require_command tr
  require_command uname

  os="$(detect_os)"
  arch="$(detect_arch)"
  archive="$(platform_archive "$os" "$arch")"
  binary_name="$(archive_binary_name "$archive")"
  expected="$(expected_checksum "$archive")"
  archive_path="$CACHE_DIR/$archive"
  url="https://github.com/rhysd/actionlint/releases/download/v$ACTIONLINT_VERSION/$archive"
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/actionlint-install.XXXXXX")"
  download_path="$TEMP_DIR/$archive"

  mkdir -p -- "$CACHE_DIR"
  if verify_binary_cache "$expected" "$archive_path" "$archive" "$binary_name"; then
    printf 'ACTIONLINT_CACHE_OK version=v%s platform=%s/%s path=%s\n' "$ACTIONLINT_VERSION" "$os" "$arch" "$BINARY_PATH"
    return 0
  fi

  if ! verify_archive "$archive_path" "$expected"; then
    rm -f -- "$archive_path"
    curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
      --output "$download_path" "$url" \
      || fail 'download-failed'
    verify_archive "$download_path" "$expected" || fail 'download-checksum-invalid'
    install -m 0600 "$download_path" "$archive_path"
  fi

  printf '%s\n' "$expected" > "$CHECKSUM_PATH"
  install_from_archive "$archive_path" "$archive" "$binary_name"
  printf 'ACTIONLINT_INSTALLED version=v%s platform=%s/%s path=%s\n' "$ACTIONLINT_VERSION" "$os" "$arch" "$BINARY_PATH"
}

main "$@"
