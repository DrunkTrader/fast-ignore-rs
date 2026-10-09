import {createRequire} from 'node:module';

type NativeMatcher = {
  readonly empty: boolean,
  matches: (relativePath: string, isDirectory: boolean) => boolean,
  matchesBatch: (relativePaths: string[], directories?: boolean[]) => boolean[]
};

type NativeModule = {
  createMatcher: (ignores: string[], caseSensitive: boolean) => NativeMatcher
};

const require = createRequire ( import.meta.url );

const native = require ( '../fast-ignore-rs-loader.cjs' ) as NativeModule;

const createNativeMatcher = (ignores: string[], caseSensitive: boolean): NativeMatcher => {
  return native.createMatcher ( ignores, caseSensitive );
};

export {createNativeMatcher};
