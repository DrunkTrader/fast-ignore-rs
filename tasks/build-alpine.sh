#!/bin/sh
set -eu

# Executed inside an official Node Alpine image on a same-architecture runner.
apk add --no-cache build-base curl
command -v gcc
gcc --version

# Alpine's build-base supplies the native gcc, not target-prefixed linkers.
case "$CARGO_BUILD_TARGET" in
  x86_64-unknown-linux-musl)
    export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=gcc
    ;;
  aarch64-unknown-linux-musl)
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=gcc
    ;;
  *)
    printf 'Unsupported musl target: %s\n' "$CARGO_BUILD_TARGET" >&2
    exit 1
    ;;
esac

curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh
sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain stable \
  --default-host "$CARGO_BUILD_TARGET" --target "$CARGO_BUILD_TARGET" \
  --component clippy,rustfmt
export PATH="$HOME/.cargo/bin:$PATH"
# Required for Rust cdylibs on musl, also used by cargo test and Clippy.
export RUSTFLAGS='-C target-feature=-crt-static'

npm ci
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
npm test
node tasks/release.mjs native "$NATIVE_TARGET"
