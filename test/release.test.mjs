import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  binaryName, collectNative, readJson, runtimeFiles, sha256, targets,
  verifyArtifact, verifyBinary, verifyFiles, verifyManifest, verifyTag
} from '../tasks/release.mjs';

const pkg = readJson ( new URL ( '../package.json', import.meta.url ) );

function temporary (t) {
  const directory = mkdtempSync ( join ( tmpdir (), 'fast-ignore-release-test-' ) );
  t.after ( () => rmSync ( directory, {recursive: true, force: true} ) );
  return directory;
}

// Header fixtures test rejection/collection only; these are not loadable addons.
function header (target) {
  const data = Buffer.alloc ( 256 );
  if ( target.startsWith ( 'linux' ) ) {
    data.write ( '\x7fELF' );
    data[4] = 2;
    data[5] = 1;
    data.writeUInt16LE ( 3, 16 );
    data.writeUInt16LE ( target.includes ( 'x64' ) ? 62 : 183, 18 );
    data.write ( target.endsWith ( 'gnu' ) ? 'libc.so.6' : `libc.musl-${target.includes ( 'x64' ) ? 'x86_64' : 'aarch64'}.so.1`, 64 );
  } else if ( target.startsWith ( 'darwin' ) ) {
    data.writeUInt32LE ( 0xfeedfacf );
    data.writeUInt32LE ( target.endsWith ( 'x64' ) ? 0x01000007 : 0x0100000c, 4 );
  } else {
    data.write ( 'MZ' );
    data.writeUInt32LE ( 64, 0x3c );
    data.writeUInt32LE ( 0x00004550, 64 );
    data.writeUInt16LE ( 0x8664, 68 );
  }
  return data;
}

test ( 'release metadata is synchronized and tags fail closed', () => {
  const lock = readJson ( new URL ( '../package-lock.json', import.meta.url ) );
  verifyManifest ( pkg );
  assert.equal ( lock.version, pkg.version );
  assert.equal ( lock.packages[''].version, pkg.version );
  verifyTag ( pkg, `refs/tags/v${pkg.version}` );
  for ( const ref of ['refs/heads/main', 'refs/tags/v0.1.0', `refs/tags/v${pkg.version}-rc.1`, undefined] ) {
    assert.throws ( () => verifyTag ( pkg, ref ) );
  }
  assert.throws ( () => verifyManifest ( {...pkg, version: '0.1.0'} ) );
  for ( const hook of ['install', 'prepare', 'prepack', 'prepublishOnly', 'publish'] ) {
    assert.throws ( () => verifyManifest ( {...pkg, scripts: {[hook]: 'npm run build'}} ) );
  }
});

test ( 'packlist rejects missing, duplicate, and extraneous files', () => {
  verifyFiles ( runtimeFiles );
  for ( const file of runtimeFiles ) assert.throws ( () => verifyFiles ( runtimeFiles.filter ( name => name !== file ) ) );
  assert.throws ( () => verifyFiles ( [...runtimeFiles, runtimeFiles[0]] ) );
  for ( const file of ['node_modules/x/index.js', 'src/lib.rs', 'target/release/addon.so', 'test/fixture', 'binding.gyp'] ) {
    assert.throws ( () => verifyFiles ( [...runtimeFiles, file] ) );
  }
});

test ( 'native collection rejects missing, renamed, and overwriting artifacts', t => {
  const directory = temporary ( t );
  const artifacts = join ( directory, 'artifacts' );
  const output = join ( directory, 'output' );
  mkdirSync ( artifacts );
  mkdirSync ( output );
  assert.throws ( () => collectNative ( artifacts, output ) );
  for ( const target of Object.keys ( targets ) ) {
    const artifact = join ( artifacts, `native-${target}` );
    mkdirSync ( artifact );
    writeFileSync ( join ( artifact, binaryName ( target ) ), header ( target ) );
  }
  const file = join ( artifacts, 'native-linux-arm64-musl', binaryName ( 'linux-arm64-musl' ) );
  writeFileSync ( file, header ( 'linux-arm64-gnu' ) );
  assert.throws ( () => collectNative ( artifacts, output ), /libc/ );
  writeFileSync ( file, header ( 'linux-x64-musl' ) );
  assert.throws ( () => verifyBinary ( file, 'linux-arm64-musl' ), /architecture/ );
  writeFileSync ( file, header ( 'linux-arm64-musl' ) );
  collectNative ( artifacts, output );
  assert.throws ( () => collectNative ( artifacts, output ), {code: 'EEXIST'} );
  for ( const target of Object.keys ( targets ) ) assert.deepEqual ( readFileSync ( join ( output, binaryName ( target ) ) ), header ( target ) );
});

test ( 'artifact verification requires the exact version and checksum', t => {
  const directory = temporary ( t );
  const file = join ( directory, `${pkg.name}-${pkg.version}.tgz` );
  writeFileSync ( file, 'checksum fixture' );
  const checksum = sha256 ( file );
  assert.equal ( verifyArtifact ( directory, checksum, pkg ), file );
  assert.throws ( () => verifyArtifact ( directory, undefined, pkg ) );
  assert.throws ( () => verifyArtifact ( directory, checksum, {...pkg, version: '99.0.0'} ) );
  writeFileSync ( file, 'changed artifact' );
  assert.throws ( () => verifyArtifact ( directory, checksum, pkg ), /differs/ );
  writeFileSync ( join ( directory, 'extra.tgz' ), 'unexpected' );
  assert.throws ( () => verifyArtifact ( directory, sha256 ( file ), pkg ), /exactly/ );
});
