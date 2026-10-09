/* IMPORT */

import {createNativeMatcher, type NativeMatcher} from './native.js';

/* TYPES */

type Options = {
  caseSensitive?: boolean
};

type PathOptions = {
  isDirectory?: boolean
};

type BatchOptions = {
  isDirectory?: boolean | boolean[]
};

type IgnoreMatcher = ((relativePath: string, options?: PathOptions) => boolean) & {
  batch: (relativePaths: string[], options?: BatchOptions) => boolean[]
};

const isEmptyIgnore = (ignores: string[]): boolean => {
  return ignores.every ( ignore => ignore.split ( /\r?\n|\r/g ).every ( line => !line.trim () || line.startsWith ( '#' ) ) );
};

/* MAIN */

const matcher = (ignore: string | string[], options: Options = {}): IgnoreMatcher => {

  const ignores = Array.isArray ( ignore ) ? ignore : [ignore];
  for ( const input of ignores ) {
    if ( typeof input !== 'string' ) throw new TypeError ( 'Ignore content must be a string' );
  }
  const inputIsEmpty = isEmptyIgnore ( ignores );
  if ( !inputIsEmpty && options === null ) throw new TypeError ( 'Matcher options cannot be null' );

  let nativeMatcher: NativeMatcher | undefined;
  if ( !inputIsEmpty ) {
    try {
      nativeMatcher = createNativeMatcher ( ignores, Boolean ( options?.caseSensitive ?? false ) );
    } catch ( error ) {
      if ( error instanceof Error && error.message.startsWith ( 'SyntaxError: ' ) ) {
        throw new SyntaxError ( error.message.slice ( 13 ) );
      }
      throw error;
    }
  }
  const isEmpty = inputIsEmpty || nativeMatcher?.empty === true;
  // The original's empty matcher returns before reading options or paths.

  const result = ((relativePath: string, pathOptions?: PathOptions): boolean => {
    if ( isEmpty ) return false;
    if ( typeof relativePath !== 'string' ) throw new TypeError ( 'Relative path must be a string' );
    const isDirectory = Boolean ( pathOptions?.isDirectory ?? false );
    return nativeMatcher!.matches ( relativePath, isDirectory );
  }) as IgnoreMatcher;

  result.batch = (relativePaths: string[], batchOptions: BatchOptions = {}): boolean[] => {
    if ( !Array.isArray ( relativePaths ) ) {
      throw new TypeError ( 'Batch paths must be an array of strings' );
    }
    for ( let i = 0; i < relativePaths.length; i++ ) {
      if ( typeof relativePaths[i] !== 'string' ) throw new TypeError ( 'Batch paths must be an array of strings' );
    }

    const directoryOption = batchOptions.isDirectory;
    const directoryValues = Array.isArray ( directoryOption ) ? directoryOption : undefined;
    const defaultDirectory = Array.isArray ( directoryOption ) || directoryOption === undefined
      ? undefined
      : directoryOption;

    if ( directoryValues?.some ( value => typeof value !== 'boolean' ) ) {
      throw new TypeError ( 'Batch directory flags must be booleans' );
    }
    if ( defaultDirectory !== undefined && typeof defaultDirectory !== 'boolean' ) {
      throw new TypeError ( 'Batch directory flag must be a boolean' );
    }

    if ( directoryValues && directoryValues.length !== relativePaths.length ) {
      throw new RangeError ( 'Batch directory flags must have the same length as paths' );
    }

    if ( isEmpty ) return relativePaths.map ( () => false );
    return nativeMatcher!.matchesBatch ( relativePaths, directoryValues, defaultDirectory );
  };

  return result;
};

/* EXPORT */

export default matcher;
export type {BatchOptions, IgnoreMatcher, Options, PathOptions};
