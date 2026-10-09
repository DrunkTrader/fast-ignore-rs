# fast-ignore-rs

`fast-ignore-rs` is a Rust and NAPI-RS implementation of the `fast-ignore` matching API for Node.js and TypeScript projects.

## Install

```sh
npm install fast-ignore-rs
```

The release pipeline for `0.1.1` assembles one npm tarball with native addons for Linux x64/ARM64 (GNU libc and Alpine musl), macOS Intel/Apple Silicon, and Windows x64 MSVC. Consumers do not need Rust installed. Node.js 18+ is supported; CI checks the installed tarball on Node.js 18, 20, 22, 24, and 26.

## Usage

```ts
import fastIgnore from 'fast-ignore-rs';

const gitignore = `
# Common generated files
*.log
dist
node_modules
dir/
`;

const ignore = fastIgnore(gitignore);

ignore('src/index.js');                 // false
ignore('node_modules/pkg/index.js');    // true
ignore('dist/index.js');                // true
ignore('dir/index.js');                 // true
ignore('dir');                          // false: type is ambiguous
ignore('dir', {isDirectory: true});    // true
```

The default export is a synchronous factory:

```ts
type Options = {
  caseSensitive?: boolean
};

type PathOptions = {
  isDirectory?: boolean
};

declare function fastIgnore(
  ignore: string | string[],
  options?: Options
): (relativePath: string, options?: PathOptions) => boolean;
```

An array represents ordered ignore files. A later file cannot re-include a path that was positively ignored by an earlier file:

```ts
const ignore = fastIgnore([
  'dist\nnode_modules',
  '!dist'
]);

ignore('dist/app.js'); // true
```

The returned function also has an additive `batch` method for reducing native-boundary crossings:

```ts
ignore.batch(['src/a.js', 'dist/a.js']); // [false, true]
```

## Benchmark results

The current Rust/NAPI-RS implementation was benchmarked against the original
`fast-ignore@2.0.0` package on 2026-10-09. Correctness was checked before
timing every scenario: individual Rust results matched the original package,
and Rust batch results matched Rust individual results.

Key results from the latest run:

- Individual matching was **4.48× faster** with many patterns, **2.32× faster**
  with long paths, and **1.06× faster** with recursive classes and negation.
  Short individual calls remained slower because of the native-call boundary.
- Batch matching was **5.31× faster** with many patterns, **2.98× faster** with
  long paths, and faster on the small, large, and recursive workloads.
- Rust matcher creation was **19–35% faster** for most workloads. Recursive/class
  creation improved substantially but remained **31.7% slower**: **24.733 µs** in
  Rust versus **18.786 µs** in the original implementation.

### Individual matching throughput

| Scenario | Workload | Original | Rust | Rust / original | Throughput change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small patterns | 4 patterns, 32 paths | 2,423,760 paths/s | 1,873,027 paths/s | 0.77× | **−22.7%** |
| Large path set | 5 patterns, 10,000 paths | 2,201,509 paths/s | 1,882,455 paths/s | 0.86× | **−14.5%** |
| Many patterns | 161 patterns, 3,000 paths | 115,028 paths/s | 515,413 paths/s | 4.48× | **+348.1%** |
| Directory rules and negation | 4 patterns, 7 paths | 2,927,429 paths/s | 1,948,558 paths/s | 0.67× | **−33.4%** |
| Long paths | 5 patterns, 10,000 paths | 464,282 paths/s | 1,077,232 paths/s | 2.32× | **+132.0%** |
| Recursive classes and negation | 5 patterns, 3,000 paths | 1,589,712 paths/s | 1,691,703 paths/s | 1.06× | **+6.4%** |

Throughput is calculated as `Rust throughput / original throughput`. Negative
values indicate that Rust processed fewer paths per second for that workload.

### Matcher creation and matching latency

Matcher creation was measured separately from repeated matching. Matching time
is the median total time for the scenario-specific number of passes over its
paths.

| Scenario | Original creation | Rust creation | Creation change | Original matching | Rust matching | Latency improvement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small patterns | 12.479 µs | 10.100 µs | **+19.1%** | 105.621 ms | 136.677 ms | **−29.4%** |
| Large path set | 16.236 µs | 12.838 µs | **+20.9%** | 109.016 ms | 127.493 ms | **−16.9%** |
| Many patterns | 553.477 µs | 361.166 µs | **+34.7%** | 104.322 ms | 23.282 ms | **+77.7%** |
| Directory rules and negation | 12.920 µs | 11.141 µs | **+13.8%** | 71.735 ms | 107.772 ms | **−50.2%** |
| Long paths | 16.113 µs | 12.748 µs | **+20.9%** | 172.309 ms | 74.264 ms | **+56.9%** |
| Recursive classes and negation | 18.786 µs | 24.733 µs | **−31.7%** | 94.357 ms | 88.668 ms | **+6.0%** |

Latency improvement is calculated as
`(original latency − Rust latency) / original latency × 100`. Creation change
uses the same formula. A negative value means Rust took longer. The directory
scenario is very small, so its sub-0.1 ms timings are especially sensitive to
timer and runtime noise.

### Batch matching comparison

The original package does not expose a batch API. For this comparison, the
original matcher is called in an ordinary JavaScript loop over the same paths,
while Rust uses one `ignore.batch()` call for the same paths and directory
flags.

| Scenario | Original JS loop | Rust batch | Rust / original | Change |
| --- | ---: | ---: | ---: | ---: |
| Small patterns | 2,405,033 paths/s | 2,630,896 paths/s | 1.09× | **+9.4%** |
| Large path set | 2,231,343 paths/s | 2,766,267 paths/s | 1.24× | **+24.0%** |
| Many patterns | 116,326 paths/s | 617,254 paths/s | 5.31× | **+430.6%** |
| Directory rules and negation | 2,986,245 paths/s | 1,888,032 paths/s | 0.63× | −36.8% |
| Long paths | 462,825 paths/s | 1,378,971 paths/s | 2.98× | **+197.9%** |
| Recursive classes and negation | 1,627,901 paths/s | 2,366,321 paths/s | 1.45× | **+45.4%** |

### Environment and methodology

- Debian GNU/Linux 12 (bookworm), Linux arm64 with glibc 2.36 on a
  Neoverse-N1 CPU;
- Node.js v22.22.3;
- Rust 1.99.0;
- native addon built with `napi build --platform --release`;
- seven measured samples per metric after two full warm-up runs;
- matching passes were selected per scenario to make the slowest implementation
  run for approximately 100 ms per sample: 8,000, 24, 4, 30, 8, and 50
  passes respectively for the rows above;
- matcher creation was also sampled for a duration sufficient to reduce timer
  noise and reported as median microseconds per matcher;
- implementation order rotated every sample to reduce consistent ordering bias;
- individual throughput includes one matcher reused across repeated path calls;
- batch throughput evaluates the same paths and directory flags, with the
  original using a JavaScript loop and Rust using `ignore.batch()`;
- correctness is checked before timing, including individual and batch results;
- memory usage was not measured reliably and is omitted.

These measurements show workload-dependent behavior. Reusing a UTF-16 buffer
for individual calls, passing scalar batch directory flags without expanding
them in JavaScript, and memoizing repeated case-folded classes improved the
native path. The native boundary still makes short individual calls slower than
direct JavaScript calls, while Rust is faster for many patterns, long paths,
recursive/class matching, and most batch workloads. Matcher reuse, pattern
complexity, path length, and the ratio of compilation to matching work materially
affect the result.

## Matching behavior

The implementation preserves the original package's parser and matcher behavior, including:

- blank lines and comments;
- `*`, `?`, character classes, escapes, and recursive `**` segments;
- negation patterns beginning with `!`;
- directory-only patterns ending in `/`;
- root-anchored patterns beginning with `/`;
- automatic matching of unanchored patterns at any depth;
- case-insensitive matching by default and `caseSensitive: true`;
- forward-slash and backslash-separated relative paths;
- ordered multi-file tiers.

This is intentionally the original `fast-ignore` grammar and trie behavior rather than a claim of complete `.gitignore` specification compatibility.

## Development

Runtime support is declared for Node.js 18+. For building from source, use
Node.js 22.20+ on the 22.x line (or Node.js 24.12+ on the 24.x line), npm,
stable Rust, and Cargo. The locked development toolchain has newer Node.js
requirements than the installed package.

```sh
npm ci
npm test
npm run build
```

`npm run build` compiles the Rust NAPI addon in release mode using `Cargo.lock` and then emits the JavaScript entry point and TypeScript declarations. `tasks/copy-native.mjs` copies the target-specific `.node` file and generated CommonJS loader to the package root. The ESM wrapper loads that loader, which selects a bundled binary by OS, architecture, and libc.

See [RELEASING.md](./RELEASING.md) for the seven-target build matrix, installed-tarball checks, and one-time npm Trusted Publishing setup. Pull requests and branch pushes validate builds; pushes to `main` and version tags also assemble and test the package. Only matching version-tag pushes can publish the tested tarball. A local `npm pack --ignore-scripts` contains only the binaries already present locally and is not a complete multi-platform release.

## Reproducing benchmarks

The benchmark uses the existing development-only npm alias for
`fast-ignore@2.0.0`. That package is used only as the comparison baseline and
is not a runtime dependency.

```sh
npm install
npm run build
npm run benchmark
```

`npm run benchmark` reuses the release-built native addon and runs the
correctness checks before collecting measurements. It does not include module
loading, filesystem traversal, or package installation time. Results will vary
with CPU, Node.js version, workload size, pattern complexity, and matcher reuse.

## License

This project is licensed under the **MIT License**. The original `fast-ignore`
implementation, adapted upstream test cases, and behavior-derived documentation
remain attributed to **Fabio Spampinato**. The Rust/NAPI-RS implementation,
package integration, CI configuration, benchmarks, and compatibility harness
are original contributions by **Neeraj Kumar** (aka **DrunkTrader**).

See [LICENSE](./LICENSE) for the complete terms and copyright notices.
