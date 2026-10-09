import {readdirSync, rmSync} from 'node:fs';

rmSync ( 'dist', {force: true, recursive: true} );
rmSync ( 'native-build', {force: true, recursive: true} );
rmSync ( 'fast-ignore-rs-loader.cjs', {force: true} );
for ( const entry of readdirSync ( '.' ).filter ( entry => /^fast-ignore-rs\..+\.node$/.test ( entry ) ) ) rmSync ( entry, {force: true} );
