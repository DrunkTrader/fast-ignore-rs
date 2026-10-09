/* IMPORT */

import {createNativeMatcher} from './native.js';

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

/* MAIN */

const matcher = (ignore: string | string[], options: Options = {}): IgnoreMatcher => {

  const ignores = Array.isArray ( ignore ) ? ignore : [ignore];
  for ( const input of ignores ) {
    if ( typeof input !== 'string' ) throw new TypeError ( 'Ignore content must be a string' );
  }
  let nativeMatcher;
  try {
    nativeMatcher = createNativeMatcher ( ignores, Boolean ( options?.caseSensitive ?? false ) );
  } catch ( error ) {
    if ( error instanceof Error && error.message.startsWith ( 'SyntaxError: ' ) ) {
      throw new SyntaxError ( error.message.slice ( 13 ) );
    }
    throw error;
  }
  const isEmpty = nativeMatcher.empty;
  // The original's empty matcher returns before reading options or paths.
  if ( !isEmpty && options === null ) throw new TypeError ( 'Matcher options cannot be null' );

  const result = ((relativePath: string, pathOptions?: PathOptions): boolean => {
    if ( isEmpty ) return false;
    if ( typeof relativePath !== 'string' ) throw new TypeError ( 'Relative path must be a string' );
    const isDirectory = Boolean ( pathOptions?.isDirectory ?? false );
    return nativeMatcher.matches ( relativePath, isDirectory );
  }) as IgnoreMatcher;

  result.batch = (relativePaths: string[], batchOptions: BatchOptions = {}): boolean[] => {
    if ( !Array.isArray ( relativePaths ) || relativePaths.some ( path => typeof path !== 'string' ) ) {
      throw new TypeError ( 'Batch paths must be an array of strings' );
    }
    const directoryValues = Array.isArray ( batchOptions.isDirectory )
      ? batchOptions.isDirectory
      : batchOptions.isDirectory === undefined
        ? undefined
        : relativePaths.map ( () => batchOptions.isDirectory as boolean );

    if ( directoryValues && directoryValues.length !== relativePaths.length ) {
      throw new RangeError ( 'Batch directory flags must have the same length as paths' );
    }

    return nativeMatcher.matchesBatch ( relativePaths, directoryValues );
  };

  return result;
};

/* EXPORT */

export default matcher;
export type {BatchOptions, IgnoreMatcher, Options, PathOptions};
