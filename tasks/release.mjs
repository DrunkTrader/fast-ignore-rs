import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync, constants, copyFileSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const targets = {
  'linux-x64-gnu': 'x86_64-unknown-linux-gnu',
  'linux-arm64-gnu': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64-msvc': 'x86_64-pc-windows-msvc',
  'linux-x64-musl': 'x86_64-unknown-linux-musl',
  'linux-arm64-musl': 'aarch64-unknown-linux-musl'
};

export const binaryName = target => `fast-ignore-rs.${target}.node`;
export const runtimeFiles = [
  'package.json', 'README.md', 'LICENSE', 'fast-ignore-rs-loader.cjs',
  'dist/index.js', 'dist/index.d.ts', 'dist/native.js', 'dist/native.d.ts',
  ...Object.keys ( targets ).map ( binaryName )
];

export const sha256 = file => createHash ( 'sha256' ).update ( readFileSync ( file ) ).digest ( 'hex' );
export const readJson = file => JSON.parse ( readFileSync ( file, 'utf8' ) );

export function verifyManifest (pkg) {
  assert.equal ( pkg.name, 'fast-ignore-rs' );
  assert.match ( pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/ );
  assert.notEqual ( pkg.version, '0.1.0', '0.1.0 is already published' );
  for ( const hook of ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish'] ) {
    assert.equal ( pkg.scripts?.[hook], undefined, `Prebuilt releases must not run ${hook}` );
  }
}

export function verifyTag (pkg, ref) {
  verifyManifest ( pkg );
  assert.equal ( ref, `refs/tags/v${pkg.version}`, 'Release tag must exactly match package.json' );
}

export function verifyFiles (files) {
  assert.equal ( new Set ( files ).size, files.length, 'Duplicate tarball filenames' );
  assert.deepEqual ( [...files].sort (), [...runtimeFiles].sort (), 'Missing or unexpected runtime files' );
}

export function verifyRuntime (target) {
  assert.ok ( Object.hasOwn ( targets, target ), `Unknown target: ${target}` );
  const [platform, arch, libc] = target.split ( '-' );
  assert.equal ( process.platform, platform );
  assert.equal ( process.arch, arch );
  if ( platform === 'linux' ) {
    const glibc = process.report.getReport ().header.glibcVersionRuntime;
    assert.equal ( glibc ? 'gnu' : 'musl', libc, 'Node must run against the intended libc' );
  }
}

export function verifyBinary (file, target) {
  assert.ok ( Object.hasOwn ( targets, target ), `Unknown target: ${target}` );
  const data = readFileSync ( file );
  const [platform, arch, libc] = target.split ( '-' );
  assert.ok ( data.length > 64, `Empty/truncated binary: ${file}` );
  if ( platform === 'linux' ) {
    assert.equal ( data.subarray ( 0, 4 ).toString ( 'hex' ), '7f454c46', 'Expected ELF' );
    assert.equal ( data[4], 2, 'Expected ELF64' );
    assert.equal ( data[5], 1, 'Expected little endian ELF' );
    assert.equal ( data.readUInt16LE ( 16 ), 3, 'Expected ELF shared library' );
    assert.equal ( data.readUInt16LE ( 18 ), arch === 'x64' ? 62 : 183, 'Wrong ELF architecture' );
    const musl = data.includes ( Buffer.from ( `libc.musl-${arch === 'x64' ? 'x86_64' : 'aarch64'}.so.1` ) );
    assert.equal ( musl, libc === 'musl', 'Wrong libc dependency' );
    assert.equal ( data.includes ( Buffer.from ( 'libc.so.6' ) ), libc === 'gnu', 'Wrong GNU libc dependency' );
  } else if ( platform === 'darwin' ) {
    assert.equal ( data.readUInt32LE ( 0 ), 0xfeedfacf, 'Expected Mach-O 64' );
    assert.equal ( data.readUInt32LE ( 4 ), arch === 'x64' ? 0x01000007 : 0x0100000c, 'Wrong Mach-O architecture' );
  } else {
    assert.equal ( data.toString ( 'ascii', 0, 2 ), 'MZ', 'Expected PE' );
    const offset = data.readUInt32LE ( 0x3c );
    assert.equal ( data.readUInt32LE ( offset ), 0x00004550, 'Expected PE signature' );
    assert.equal ( data.readUInt16LE ( offset + 4 ), 0x8664, 'Expected x64 PE' );
  }
}

export function collectNative (directory, destination = '.') {
  // Keep artifact directories separate until names, headers and hashes pass.
  // COPYFILE_EXCL also refuses to overwrite a packaging-runner binary.
  assert.deepEqual ( readdirSync ( directory ).sort (), Object.keys ( targets ).map ( target => `native-${target}` ).sort () );
  const hashes = new Set ();
  const files = Object.keys ( targets ).map ( target => {
    const name = binaryName ( target );
    const artifact = join ( directory, `native-${target}` );
    assert.deepEqual ( readdirSync ( artifact ), [name], `Unexpected artifact contents: ${artifact}` );
    const file = join ( artifact, name );
    verifyBinary ( file, target );
    const hash = sha256 ( file );
    assert.ok ( !hashes.has ( hash ), `Identical binaries for different targets: ${name}` );
    hashes.add ( hash );
    console.log ( `${hash}  ${name}` );
    return {file, name};
  });
  for ( const {file, name} of files ) copyFileSync ( file, join ( destination, name ), constants.COPYFILE_EXCL );
}

export function npm (args, options = {}) {
  // npm is a .cmd shim on Windows. Quote arguments including temporary paths.
  return execFileSync ( 'npm', process.platform === 'win32' ? args.map ( arg => `"${arg}"` ) : args, {
    encoding: 'utf8', shell: process.platform === 'win32', ...options
  });
}

export function verifyArtifact (directory, expectedHash, pkg = readJson ( 'package.json' )) {
  verifyManifest ( pkg );
  assert.match ( expectedHash ?? '', /^[a-f0-9]{64}$/, 'Missing package-job SHA-256' );
  const filename = `${pkg.name}-${pkg.version}.tgz`;
  assert.deepEqual ( readdirSync ( directory ), [filename], 'Expected exactly the tested tarball' );
  const file = resolve ( directory, filename );
  assert.equal ( sha256 ( file ), expectedHash, 'Tarball differs from the assembled artifact' );
  return file;
}

function inspectTarball (file, pkg) {
  const files = execFileSync ( 'tar', ['-tzf', file], {encoding: 'utf8'} ).trim ().split ( /\r?\n/ );
  verifyFiles ( files.map ( name => {
    assert.ok ( name.startsWith ( 'package/' ) );
    return name.slice ( 'package/'.length );
  }) );
  const packed = JSON.parse ( execFileSync ( 'tar', ['-xOf', file, 'package/package.json'], {encoding: 'utf8'} ) );
  verifyManifest ( packed );
  assert.equal ( packed.version, pkg.version, 'Wrong tarball version' );
  assert.deepEqual ( packed, pkg, 'Tarball metadata differs from the checked-out commit' );
}

function pack () {
  const pkg = readJson ( 'package.json' );
  verifyManifest ( pkg );
  const lock = readJson ( 'package-lock.json' );
  assert.equal ( lock.version, pkg.version );
  assert.equal ( lock.packages[''].version, pkg.version );
  for ( const target of Object.keys ( targets ) ) verifyBinary ( binaryName ( target ), target );
  for ( const dryRun of [true, false] ) {
    const result = JSON.parse ( npm ( ['pack', '--ignore-scripts', '--json', ...(dryRun ? ['--dry-run'] : [])] ) );
    assert.equal ( result.length, 1 );
    assert.equal ( result[0].name, pkg.name );
    assert.equal ( result[0].version, pkg.version );
    verifyFiles ( result[0].files.map ( file => file.path ) );
    console.log ( JSON.stringify ( result[0], null, 2 ) );
  }
  const filename = `${pkg.name}-${pkg.version}.tgz`;
  inspectTarball ( filename, pkg );
  const hash = sha256 ( filename );
  console.log ( `SHA-256: ${hash}  ${filename}` );
  if ( process.env.GITHUB_OUTPUT ) appendFileSync ( process.env.GITHUB_OUTPUT, `filename=${filename}\nsha256=${hash}\n` );
}

if ( process.argv[1] && import.meta.url === pathToFileURL ( resolve ( process.argv[1] ) ).href ) {
  const [command, argument] = process.argv.slice ( 2 );
  if ( command === 'native' ) {
    verifyRuntime ( argument );
    assert.equal ( process.env.CARGO_BUILD_TARGET, targets[argument] );
    const rust = execFileSync ( 'rustc', ['-vV'], {encoding: 'utf8'} );
    assert.ok ( rust.includes ( `host: ${targets[argument]}` ), 'Expected a native Rust toolchain' );
    assert.deepEqual ( readdirSync ( 'native-build' ).filter ( name => name.endsWith ( '.node' ) ), [binaryName ( argument )] );
    verifyBinary ( binaryName ( argument ), argument );
  } else if ( command === 'collect' ) {
    collectNative ( argument );
  } else if ( command === 'pack' ) {
    pack ();
  } else if ( command === 'tag' ) {
    verifyTag ( readJson ( 'package.json' ), process.env.GITHUB_REF );
  } else if ( command === 'artifact' ) {
    const pkg = readJson ( 'package.json' );
    inspectTarball ( verifyArtifact ( argument, process.env.RELEASE_SHA256, pkg ), pkg );
  } else {
    throw new Error ( 'Usage: node tasks/release.mjs native <target> | collect <directory> | pack | tag | artifact <directory>' );
  }
}
