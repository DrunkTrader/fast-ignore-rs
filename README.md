# fast-ignore-rs

`fast-ignore-rs` is a Rust and NAPI-RS implementation of the `fast-ignore` matching API for Node.js and TypeScript projects.

## Install

```sh
npm install fast-ignore-rs
```

Each npm artifact includes the target-specific native addon produced by NAPI-RS, so consumers do not need Rust installed. A multi-platform release should collect the `.node` artifacts from the CI runners before packing the root package.

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

- Individual matching was **4.46× faster** with many patterns and **2.31×
  faster** with long paths. Short individual calls remained slower because of
  the native-call boundary.
- Batch matching was **5.12× faster** with many patterns, **2.79× faster** with
  long paths, and faster on the small, large, and recursive workloads.
- Rust matcher creation was **21–36% faster** for most workloads, with the
  recursive/class workload as the exception: **169.522 µs** in Rust versus
  **19.328 µs** in the original implementation.

### Individual matching throughput

| Scenario | Workload | Original | Rust | Rust / original | Throughput change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small patterns | 4 patterns, 32 paths | 2,351,827 paths/s | 1,871,408 paths/s | 0.80× | **−20.4%** |
| Large path set | 5 patterns, 10,000 paths | 2,195,995 paths/s | 1,828,747 paths/s | 0.83× | **−16.7%** |
| Many patterns | 161 patterns, 3,000 paths | 118,839 paths/s | 530,126 paths/s | 4.46× | **+346.1%** |
| Directory rules and negation | 4 patterns, 7 paths | 2,975,597 paths/s | 1,864,207 paths/s | 0.63× | **−37.4%** |
| Long paths | 5 patterns, 10,000 paths | 460,082 paths/s | 1,063,479 paths/s | 2.31× | **+131.1%** |
| Recursive classes and negation | 5 patterns, 3,000 paths | 1,634,113 paths/s | 1,612,613 paths/s | 0.99× | **−1.3%** |

Throughput is calculated as `Rust throughput / original throughput`. Negative
values indicate that Rust processed fewer paths per second for that workload.

### Matcher creation and matching latency

Matcher creation was measured separately from repeated matching. Matching time
is the median total time for the scenario-specific number of passes over its
paths.

| Scenario | Original creation | Rust creation | Creation change | Original matching | Rust matching | Latency improvement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small patterns | 12.700 µs | 9.654 µs | **+24.0%** | 136.064 ms | 170.994 ms | **−25.7%** |
| Large path set | 15.807 µs | 12.444 µs | **+21.3%** | 95.629 ms | 114.833 ms | **−20.1%** |
| Many patterns | 558.529 µs | 359.490 µs | **+35.6%** | 100.977 ms | 22.636 ms | **+77.6%** |
| Directory rules and negation | 12.743 µs | 10.597 µs | **+16.8%** | 70.574 ms | 112.648 ms | **−59.6%** |
| Long paths | 15.845 µs | 11.937 µs | **+24.7%** | 173.882 ms | 75.225 ms | **+56.7%** |
| Recursive classes and negation | 19.328 µs | 169.522 µs | **−777.1%** | 99.136 ms | 100.458 ms | **−1.3%** |

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
| Small patterns | 2,381,041 paths/s | 2,586,273 paths/s | 1.09× | **+8.6%** |
| Large path set | 2,214,740 paths/s | 2,708,753 paths/s | 1.22× | **+22.3%** |
| Many patterns | 120,820 paths/s | 618,478 paths/s | 5.12× | **+411.9%** |
| Directory rules and negation | 2,865,712 paths/s | 1,863,917 paths/s | 0.65× | −35.0% |
| Long paths | 472,107 paths/s | 1,314,927 paths/s | 2.79× | **+178.5%** |
| Recursive classes and negation | 1,625,933 paths/s | 2,314,090 paths/s | 1.42× | **+42.3%** |

### Environment and methodology

- Debian GNU/Linux 12 (bookworm), Linux arm64 with glibc 2.36 on a
  Neoverse-N1 CPU;
- Node.js v22.22.3;
- Rust 1.99.0;
- native addon built with `napi build --platform --release`;
- seven measured samples per metric after two full warm-up runs;
- matching passes were selected per scenario to make the slowest implementation
  run for approximately 100 ms per sample: 10,000, 21, 4, 30, 8, and 54
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
for individual calls and processing batch paths as NAPI strings improved the
native batch path substantially. The native boundary still makes short
individual calls slower than direct JavaScript calls, while Rust is faster for
many patterns, long paths, and most batch workloads. Recursive/class matching
has a large Rust matcher-creation cost despite similar steady-state individual
latency. Matcher reuse, pattern complexity, path length, and the ratio of
compilation to matching work materially affect the result.

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

Requirements for building from source are Node.js 18+, npm, Rust, and Cargo.

```sh
npm install
npm test
npm run build
```

`npm run build` compiles the Rust NAPI addon in release mode and then emits the JavaScript entry point and TypeScript declarations. The addon is written to the package root as a target-specific `.node` file. The generated NAPI-RS loader also supports the corresponding optional-dependency layout when platform packages are assembled for a release.

To prepare platform-specific npm artifacts, run:

```sh
npm run release:prepare
npm pack
```

The CI workflow builds and tests on Linux, macOS, and Windows runners. This development environment verified Linux arm64 with glibc; other targets require their corresponding CI runner or a NAPI-RS cross-build environment.

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
