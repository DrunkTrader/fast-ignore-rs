import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {binaryName, npm, readJson, verifyArtifact, verifyRuntime} from './release.mjs';

const [directory, target] = process.argv.slice ( 2 );
verifyRuntime ( target );
const pkg = readJson ( 'package.json' );
const tarball = verifyArtifact ( directory, process.env.RELEASE_SHA256, pkg );
const project = mkdtempSync ( join ( tmpdir (), 'fast-ignore-package-' ) );
const env = {...process.env};
// Ensure that the bundled loader, rather than an external override, is tested.
for ( const name of Object.keys ( env ) ) if ( name.startsWith ( 'NAPI_RS_' ) ) delete env[name];
delete env.NODE_PATH;

try {
  writeFileSync ( join ( project, 'package.json' ), JSON.stringify ( {name: 'package-smoke', version: '1.0.0', private: true, type: 'module'} ) );
  // No --ignore-scripts here: a consumer's ordinary install must also be safe.
  npm ( ['install', '--no-audit', '--no-fund', '--package-lock=false', tarball], {cwd: project, env, stdio: 'inherit'} );
  const installed = readJson ( join ( project, 'node_modules/fast-ignore-rs/package.json' ) );
  assert.equal ( installed.name, pkg.name );
  assert.equal ( installed.version, pkg.version );
  writeFileSync ( join ( project, 'smoke.mjs' ), `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {basename} from 'node:path';
    import fastIgnore from 'fast-ignore-rs';
    const ignore = fastIgnore('dist/\\n*.log\\n!keep.log');
    assert.equal(ignore('dist/index.js'), true);
    assert.equal(ignore('src/index.js'), false);
    assert.equal(ignore('logs/build.log'), true);
    assert.equal(ignore('keep.log'), false);
    assert.deepEqual(ignore.batch(['dist', 'src/index.js'], {isDirectory: [true, false]}), [true, false]);
    const require = createRequire(import.meta.url);
    const loaded = Object.keys(require.cache).filter(file => file.endsWith('.node')).map(file => basename(file));
    assert.deepEqual(loaded, [${JSON.stringify ( binaryName ( target ) )}]);
    console.log('Installed fast-ignore-rs ${pkg.version}: ${target}, Node ' + process.version + ' passed');
  ` );
  execFileSync ( process.execPath, [join ( project, 'smoke.mjs' )], {cwd: project, env, stdio: 'inherit'} );
} finally {
  rmSync ( project, {recursive: true, force: true} );
}
