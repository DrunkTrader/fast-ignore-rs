import {copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const sourceDirectory = 'native-build';
const nativeFiles = readdirSync ( sourceDirectory ).filter ( file => file.endsWith ( '.node' ) );

if ( !nativeFiles.length ) {
  throw new Error ( `NAPI-RS did not produce a native addon in ${sourceDirectory}` );
}

mkdirSync ( '.', {recursive: true} );
for ( const file of nativeFiles ) copyFileSync ( join ( sourceDirectory, file ), file );

// Keep the NAPI-RS generated platform/optional-dependency loader beside the
// root-level artifacts so the published ESM wrapper can load it with require.
writeFileSync ( 'fast-ignore-rs-loader.cjs', readFileSync ( join ( sourceDirectory, 'index.js' ) ) );
