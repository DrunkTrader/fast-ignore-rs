import os from 'node:os';
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {setImmediate} from 'node:timers/promises';
import path from 'node:path';
import fastIgnore from '../dist/index.js';
import originalFastIgnore from 'fast-ignore-original';

const SAMPLES = 7;
const WARMUP_RUNS = 2;
const TARGET_MS = 100;

const median = values => {
  const sorted = [...values].sort ( (a, b) => a - b );
  const middle = Math.floor ( sorted.length / 2 );
  return sorted.length % 2 ? sorted[middle] : ( sorted[middle - 1] + sorted[middle] ) / 2;
};

const time = fn => {
  const start = performance.now ();
  const result = fn ();
  return {elapsed: performance.now () - start, result};
};

const makePaths = count => {
  const paths = [];

  for ( let i = 0; i < count; i++ ) {
    const bucket = i % 10;
    if ( bucket === 0 ) paths.push ( `node_modules/package-${i}/index.js` );
    else if ( bucket === 1 ) paths.push ( `dist/chunk-${i}.js` );
    else if ( bucket === 2 ) paths.push ( `src/logs/build-${i}.log` );
    else if ( bucket === 3 ) paths.push ( `src/test/test-${i}.js` );
    else paths.push ( `src/components/component-${i}.js` );
  }

  return paths;
};

export const scenarios = [
  {
    name: 'small patterns',
    ignores: ['node_modules', 'dist/', '*.log', '!dist/keep.log'],
    paths: makePaths ( 32 )
  },
  {
    name: 'large path set',
    ignores: ['node_modules', 'dist/', '**/test/', '*.log', '!src/logs/keep.log'],
    paths: makePaths ( 10000 )
  },
  {
    name: 'many patterns',
    ignores: [
      ...Array.from ({length: 120}, (_, index) => `generated-${index}/`),
      ...Array.from ({length: 40}, (_, index) => `**/*-${index}.tmp`),
      '!generated-10/keep.js'
    ],
    paths: makePaths ( 3000 )
  },
  {
    name: 'directory rules and negation',
    ignores: ['**/cache/', 'build/', 'coverage', '!src/cache/keep.js'],
    paths: ['cache', 'src/cache', 'src/cache/a.js', 'src/cache/keep.js', 'build', 'build/a.js', 'coverage'],
    directories: [true, true, false, false, true, false, false]
  },
  {
    name: 'long paths',
    ignores: ['node_modules', 'dist/', '**/test/', '*.log', '!src/logs/keep.log'],
    paths: makePaths ( 10000 ).map ( p => `${'packages/workspace/'.repeat ( 12 )}${p}` )
  },
  {
    name: 'recursive classes and negation',
    // A single file makes the re-inclusion effective, unlike the tiered cases.
    ignores: '**/generated/[a-z]*.js\n**/cache/\n*.log\n!keep.log\n/src/private/**',
    paths: Array.from ({length: 3000}, (_, i) => [
      `src/generated/a${i}.js`, `lib/cache/${i}/data.bin`,
      `logs/build${i}.log`, 'logs/keep.log', `src/private/${i}/data`,
      `src/components/widget${i}.tsx`
    ][i % 6])
  }
];

const individual = (factory, ignores, paths, directories = undefined) => {
  const matcher = factory ( ignores );
  return paths.map ( (path, index) => matcher ( path, {isDirectory: directories?.[index] ?? false} ) );
};

const assertParity = (scenario, original, native) => {
  const originalResults = individual ( original, scenario.ignores, scenario.paths, scenario.directories );
  const nativeResults = individual ( native, scenario.ignores, scenario.paths, scenario.directories );

  if ( JSON.stringify ( originalResults ) !== JSON.stringify ( nativeResults ) ) {
    throw new Error ( `Correctness mismatch in ${scenario.name}` );
  }

  const nativeMatcher = native ( scenario.ignores );
  const batchResults = nativeMatcher.batch ( scenario.paths, {isDirectory: scenario.directories} );
  if ( JSON.stringify ( nativeResults ) !== JSON.stringify ( batchResults ) ) {
    throw new Error ( `Batch correctness mismatch in ${scenario.name}` );
  }
  return originalResults.reduce ( (sum, value) => sum + Number ( value ), 0 );
};

// Yield between samples so native object finalizers can run. With --expose-gc,
// collect outside the timed region; allocations/GC within a sample remain timed.
const settle = async () => {
  await setImmediate ();
  global.gc?. ();
  await setImmediate ();
};

export const measureGroup = async (runners, unitsPerIteration, fixedIterations) => {
  const entries = Object.entries ( runners );
  let iterations = fixedIterations ?? 1;
  if ( fixedIterations === undefined ) {
    let longest = 0;
    do {
      longest = 0;
      for ( const [, run] of entries ) {
        await settle ();
        longest = Math.max ( longest, time ( () => run ( iterations ) ).elapsed );
      }
      if ( longest < TARGET_MS ) iterations *= Math.max ( 2, Math.min ( 10, Math.ceil ( TARGET_MS / Math.max ( longest, 0.01 ) ) ) );
    } while ( longest < TARGET_MS );
  }
  for ( let warmup = 0; warmup < WARMUP_RUNS; warmup++ ) {
    for ( const [, run] of entries ) { await settle (); run ( iterations ); }
  }
  const samples = Object.fromEntries ( entries.map ( ([name]) => [name, []] ) );
  for ( let sample = 0; sample < SAMPLES; sample++ ) {
    // Rotate first position every sample, not just between unrelated scenarios.
    for ( let offset = 0; offset < entries.length; offset++ ) {
      const [name, run] = entries[(sample + offset) % entries.length];
      await settle ();
      samples[name].push ( time ( () => run ( iterations ) ).elapsed );
    }
  }
  const operations = iterations * unitsPerIteration;
  return {
    iterations,
    operations,
    metrics: Object.fromEntries ( Object.entries ( samples ).map ( ([name, samplesMs]) => {
      const medianMs = median ( samplesMs );
      const madMs = median ( samplesMs.map ( value => Math.abs ( value - medianMs ) ) );
      return [name, {samplesMs, medianMs, madPct: 100 * madMs / medianMs,
        pathsPerSecond: operations * 1000 / medianMs, nsPerPath: medianMs * 1e6 / operations}];
    }) )
  };
};

const matchingRunners = (scenario, expected) => {
  const {paths, directories, ignores} = scenario;
  const individualRunner = factory => {
    const matcher = factory ( ignores );
    return iterations => {
      let sum = 0;
      for ( let pass = 0; pass < iterations; pass++ ) {
        for ( let i = 0; i < paths.length; i++ ) {
          sum += Number ( matcher ( paths[i], {isDirectory: directories?.[i] ?? false} ) );
        }
      }
      assert.equal ( sum, expected * iterations );
    };
  };
  const originalBatch = originalFastIgnore ( ignores );
  const rustBatch = fastIgnore ( ignores );
  const batchRunner = batch => iterations => {
    let sum = 0;
    for ( let pass = 0; pass < iterations; pass++ ) {
      for ( const result of batch () ) sum += Number ( result );
    }
    assert.equal ( sum, expected * iterations );
  };
  return {
    originalIndividual: individualRunner ( originalFastIgnore ),
    rustIndividual: individualRunner ( fastIgnore ),
    // Both batch runners allocate/return boolean[] and consume every result.
    originalBatch: batchRunner ( () => {
      const results = new Array ( paths.length );
      for ( let i = 0; i < paths.length; i++ ) results[i] = originalBatch ( paths[i], {isDirectory: directories?.[i] ?? false} );
      return results;
    }),
    rustBatch: batchRunner ( () => rustBatch.batch ( paths, {isDirectory: directories} ) )
  };
};

export const environment = () => {
  const require = createRequire ( import.meta.url );
  const binaries = Object.keys ( require.cache ).filter ( p => p.endsWith ( '.node' ) );
  assert.equal ( binaries.length, 1, 'Expected exactly one loaded native addon' );
  const binary = binaries[0];
  assert.equal ( path.dirname ( binary ), fileURLToPath ( new URL ( '..', import.meta.url ) ).replace ( /\/$/, '' ), 'Unexpected native override' );
  return {
    date: new Date ().toISOString (), node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, kernel: os.release (),
    cpu: os.cpus ()[0]?.model, logicalCPUs: os.cpus ().length,
    glibc: process.report.getReport ().header.glibcVersionRuntime,
    rust: execFileSync ( 'rustc', ['--version'], {encoding: 'utf8'} ).trim (),
    baseline: JSON.parse ( readFileSync ( path.resolve ( path.dirname ( require.resolve ( 'fast-ignore-original' ) ), '..', 'package.json' ), 'utf8' ) ).version,
    binary: path.basename ( binary ), sha256: createHash ( 'sha256' ).update ( readFileSync ( binary ) ).digest ( 'hex' ),
    forcedGcBetweenSamples: typeof global.gc === 'function'
  };
};

const main = async () => {
  const args = process.argv.slice ( 2 );
  const option = flag => args.includes ( flag ) ? args[args.indexOf ( flag ) + 1] : undefined;
  const previous = option ( '--iterations-from' );
  const fixed = previous ? JSON.parse ( readFileSync ( previous, 'utf8' ) ) : undefined;
  const report = {environment: environment (), samples: SAMPLES, warmups: WARMUP_RUNS, targetMs: TARGET_MS, scenarios: []};
  console.log ( JSON.stringify ( report.environment, null, 2 ) );
  console.log ( 'Seven samples, two full warm-ups, common iteration count, rotating order; MAD = median absolute deviation.' );
  for ( const scenario of scenarios ) {
    const expected = assertParity ( scenario, originalFastIgnore, fastIgnore );
    const old = fixed?.scenarios.find ( s => s.name === scenario.name );
    const matching = await measureGroup ( matchingRunners ( scenario, expected ), scenario.paths.length, old?.matching.iterations );
    const creation = await measureGroup ( Object.fromEntries ( [
      ['original', originalFastIgnore], ['rust', fastIgnore]
    ].map ( ([name, factory]) => [name, iterations => {
      let last;
      for ( let i = 0; i < iterations; i++ ) last = factory ( scenario.ignores );
      assert.equal ( typeof last, 'function' );
    }] ) ), 1, old?.creation.iterations );
    const entry = {name: scenario.name, patterns: Array.isArray ( scenario.ignores ) ? scenario.ignores.length : scenario.ignores.split ( '\n' ).length,
      paths: scenario.paths.length, ignored: expected, matching, creation};
    report.scenarios.push ( entry );
    console.log ( `\n${entry.name}: ${entry.patterns} rules, ${entry.paths} paths (${expected} ignored); ${matching.iterations} passes/sample` );
    for ( const [name, m] of Object.entries ( matching.metrics ) ) {
      console.log ( `${name}: ${m.pathsPerSecond.toFixed ( 0 )} paths/s; ${m.nsPerPath.toFixed ( 1 )} ns/path; ${m.medianMs.toFixed ( 3 )} ms median; MAD ${m.madPct.toFixed ( 2 )}%` );
    }
    for ( const [name, m] of Object.entries ( creation.metrics ) ) console.log ( `${name} creation: ${(m.nsPerPath / 1000).toFixed ( 3 )} µs; ${creation.iterations} creations/sample; MAD ${m.madPct.toFixed ( 2 )}%` );
  }
  if ( option ( '--output' ) ) writeFileSync ( option ( '--output' ), `${JSON.stringify ( report, null, 2 )}\n` );
};

if ( process.argv[1] && path.resolve ( process.argv[1] ) === fileURLToPath ( import.meta.url ) ) await main ();
