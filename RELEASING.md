# Releasing fast-ignore-rs

The next npm release is **0.1.1**. Version **0.1.0 is already published** and
must not be reused. Releases are one root `fast-ignore-rs` tarball containing
seven binaries; there are no separately published platform packages.

## One-time npm setup — manual action required

An npm package maintainer must open **fast-ignore-rs → Settings → Trusted
publishing** on npmjs.com and add a **GitHub Actions** publisher:

| Field | Value |
| --- | --- |
| Organization or user | `DrunkTrader` |
| Repository | `fast-ignore-rs` |
| Workflow filename | `ci.yml` (filename only) |
| Environment name | Leave empty; this workflow does not use a GitHub environment |
| Allowed actions | Enable direct **`npm publish`** |

Current npm settings default new configurations to staged publishing, so direct
publish permission must be selected. Current npm documentation also gives a new
configuration **two days to complete its first successful publish**; recreate
an expired configuration when ready to release.

**This repository change does not configure or verify those website settings.**
Saving the configuration does not validate it at npm; the first successful OIDC
publish does. Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN` secrets for this workflow.
`npm whoami` is not a Trusted Publishing test.

Trusted Publishing requires a GitHub-hosted runner, Node.js **≥22.14.0**, and
npm **≥11.5.1**. The publish job uses Node.js 24 and pinned npm 11.6.2,
`actions/setup-node` with `registry-url: https://registry.npmjs.org`, and only
`contents: read` plus `id-token: write`. Other jobs have only `contents: read`.
The public package's `repository.url` matches this public GitHub repository,
and publishing requests provenance. No token fallback is configured.

## Workflow and supported targets

`.github/workflows/ci.yml` uses this dependency graph:

```text
validate → build-and-test (5) ─┐
         → build-musl (2) ────┴→ package → test-packaged (7 targets × 5 Node versions) → publish
```

- PRs and ordinary branch pushes: configuration checks and all seven builds
  with formatting, Clippy, Rust tests, TypeScript checks, and existing JS suites.
- Push to `main`: also assemble `npm-package` and test it on every target.
- Push a `v*` tag: first require an exact stable `v<package.json version>` match,
  then repeat builds, packaging, and installed-package tests before publishing.
- Manual runs can build; a manual run on `main` or a valid version tag can also
  package/test, but **cannot publish**. Forks cannot run the publish job.
- Failed or skipped required jobs prevent publishing. The workflow never
  creates tags or pushes commits.

| Binary suffix¹ | Rust target | Build runner/environment |
| --- | --- | --- |
| `linux-x64-gnu` | `x86_64-unknown-linux-gnu` | `ubuntu-24.04` |
| `linux-arm64-gnu` | `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` |
| `darwin-x64` | `x86_64-apple-darwin` | `macos-15-intel` |
| `darwin-arm64` | `aarch64-apple-darwin` | `macos-15` |
| `win32-x64-msvc` | `x86_64-pc-windows-msvc` | `windows-2022` |
| `linux-x64-musl` | `x86_64-unknown-linux-musl` | `ubuntu-24.04`, native `linux/amd64` Alpine container |
| `linux-arm64-musl` | `aarch64-unknown-linux-musl` | `ubuntu-24.04-arm`, native `linux/arm64` Alpine container |

¹ Every filename is `fast-ignore-rs.<suffix>.node`, uploaded as `native-<suffix>`.
Other OS/architecture combinations are not bundled or supported by this pipeline.

GNU builds use NAPI-RS `--use-napi-cross` on matching native CPU runners to
target the toolchain's glibc 2.17 baseline, rather than the runner's newer libc.
Installed-package checks run on Ubuntu 22.04. Alpine builds run `npm ci` and the
full source checks inside `node:22-alpine3.21`, with stable musl-host Rust,
Clippy/rustfmt, and `-C target-feature=-crt-static` for the shared addon.
Alpine package tests use native `node:<major>-alpine` containers, without QEMU
or a glibc compatibility layer. Runtime platform/architecture/libc, Rust host,
explicit Cargo target, and ELF/Mach-O/PE headers are checked.

Node.js 18, 20, 22, 24, and 26 each install the same tarball in a fresh temporary
project, exercise individual and batch matching, and verify the actual loaded
`.node` filename. Node 18/20 remain in these checks because `engines.node` is
`>=18`; development dependencies are installed only on the build Node version.

Packaging rebuilds the existing wrapper/declarations/loader, removes the
packaging runner's root binary, and downloads seven **separate** artifact
directories. Collection rejects missing/unexpected filenames, incompatible
headers/libc, identical binaries across targets, and destination overwrites.
Both `npm pack --dry-run --ignore-scripts` and the actual tarball must contain
exactly the runtime allowlist in `tasks/release.mjs`: manifest, README, license,
four `dist` JS/declaration files, loader, and seven binaries. A SHA-256 job output
binds every smoke test and the publish job to that exact archive. Publishing
rechecks the tag, checksum, tarball version/metadata, and file list, then runs
`npm publish <that.tgz> --access public --provenance --ignore-scripts`.

`npm run build`, `npm test`, compatibility tests, and benchmarks remain available.
There are no install/prepare/pack/publish lifecycle rebuild hooks. Cargo's crate
version is independent of the npm version; the npm manifest controls the release
tag, generated loader version, and tarball name.

## Inspect a run and download the package

In GitHub **Actions → CI**, open the run for the intended commit. Check all build
and packaged-test jobs, then download **npm-package** from **Artifacts**. It
contains `fast-ignore-rs-0.1.1.tgz`; native artifacts are available individually.
Artifacts are retained for 14 days. The package job logs the full packlist and
SHA-256 checksum.

Equivalent GitHub CLI commands (replace `RUN_ID`):

```sh
gh run list --repo DrunkTrader/fast-ignore-rs --workflow ci.yml
gh run view RUN_ID --repo DrunkTrader/fast-ignore-rs
gh run download RUN_ID --repo DrunkTrader/fast-ignore-rs --name npm-package --dir release-download
tar -tzf release-download/fast-ignore-rs-0.1.1.tgz
```

For a local smoke test on a supported host, use the SHA-256 from that run and
the corresponding suffix (example: GNU Linux ARM64):

```sh
RELEASE_SHA256=CHECKSUM_FROM_PACKAGE_JOB node tasks/test-package.mjs release-download linux-arm64-gnu
```

This uses the checked-out `package.json` version, so use the same commit as the run.

## Create the release tag — maintainer action only

First review and merge the implementation, get a successful `main` package/test
run, complete the npm website setup above, and inspect the downloaded tarball.
With a clean checkout of that reviewed release commit, check:

```sh
git status --short --branch
node -p "require('./package.json').version"
node -p "require('./package-lock.json').packages[''].version"
git tag --list v0.1.1
git ls-remote --tags origin refs/tags/v0.1.1
```

Both versions must be `0.1.1`, and the tag must not already exist. When ready to
publish, explicitly create and push the matching tag:

```sh
git tag -a v0.1.1 -m "Release 0.1.1"
git push origin refs/tags/v0.1.1
```

The tag push triggers publishing after all checks pass. Do not force-move an
existing tag. Future releases update both npm version fields and use a new tag.

## Verify the published release

After the publish job succeeds, inspect the registry and provenance on the npm
package page:

```sh
npm view fast-ignore-rs@0.1.1 version dist.integrity dist.attestations --json
npm pack fast-ignore-rs@0.1.1 --ignore-scripts
tar -tzf fast-ignore-rs-0.1.1.tgz
```

Run the download/pack commands in an empty inspection directory. Expect all
seven filenames from the table, the loader, declarations, README, and license.
Compare the archive's SHA-256 to the successful package job. In a fresh Node.js
project, install the published version and execute the public API:

```sh
npm init -y
npm install fast-ignore-rs@0.1.1
node --input-type=module -e "import assert from 'node:assert/strict'; import ignore from 'fast-ignore-rs'; assert.equal(ignore('*.log')('build.log'), true)"
```

## Troubleshooting

- **Build:** inspect the failing matrix entry, Node version, `rustc -vV`, explicit
  Cargo target, and generated filename. `npm ci` and Cargo `--locked` must pass;
  resolve lockfile changes deliberately. For Alpine, check Docker image pulls,
  `apk`/rustup availability, musl host components, and `RUSTFLAGS`.
- **Artifact collection:** every `native-<suffix>` must contain only its matching
  nonempty `.node`. Do not rename a GNU binary to musl or x64 to ARM64. Keep
  downloads separated; rebuild failed targets rather than dropping them.
- **Packlist:** compare the dry-run log with `runtimeFiles`. If runtime output
  intentionally changes, update both the `files` configuration and verification
  allowlist. Do not loosen the check to include caches, source, or fixtures.
- **Installed smoke test:** inspect the loader error and actual platform/libc.
  Confirm that the checksum matches and that no external `NAPI_RS_*` override is
  involved. Reproduce with the downloaded tarball in the same runner/container.
- **Publish authentication:** check the exact case-sensitive npm publisher fields,
  direct `npm publish` permission, configuration expiry, job `id-token: write`,
  Node/npm versions, and `repository.url`. No stored token is needed. A missing
  artifact, wrong tag/version, checksum mismatch, or failed test must be fixed;
  do not bypass it by publishing the working directory.
- **Retry:** an authentication-only failure can be retried while the tested
  artifact is retained. If it has expired, rerun the full workflow to rebuild and
  retest. An already published version cannot be overwritten; inspect npm before
  retrying after an ambiguous publish response.

## Official references

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [GitHub-hosted runner labels and architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [NAPI-RS cross builds and glibc baseline](https://napi.rs/docs/cross-build)
- [NAPI-RS Alpine shared-library flags](https://napi.rs/docs/more/faq)
- [Official Node Docker images](https://hub.docker.com/_/node)
