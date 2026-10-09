import assert from 'node:assert/strict';
import test from 'node:test';
import fastIgnore from '../dist/index.js';

const matches = (ignore, path, caseSensitive = false, isDirectory = false) => {
  return fastIgnore ( ignore, {caseSensitive} ) ( path, {isDirectory} );
};

test ( 'the public factory returns a synchronous path matcher', () => {

  const ignore = fastIgnore ( 'dist\nnode_modules\n*.log' );

  assert.equal ( ignore ( 'src/index.js' ), false );
  assert.equal ( ignore ( 'dist/index.js' ), true );
  assert.equal ( ignore ( 'node_modules/pkg/index.js' ), true );
  assert.equal ( ignore ( 'logs/app.log' ), true );

});

test ( 'comments, escapes, wildcards, and normalization match the original', () => {

  assert.equal ( matches ( '#foo.js', 'foo.js' ), false );
  assert.equal ( matches ( '#foo.js', '#foo.js' ), false );
  assert.equal ( matches ( '\\#foo.js', '#foo.js' ), true );
  assert.equal ( matches ( '\\!foo.js', '!foo.js' ), true );
  assert.equal ( matches ( '\\*', '*' ), true );
  assert.equal ( matches ( '\\*', 'foo' ), false );
  assert.equal ( matches ( '\\?', '?' ), true );
  assert.equal ( matches ( 'foo.js  ', 'foo.js' ), true );
  assert.equal ( matches ( 'foo.js\\  ', 'foo.js' ), false );
  assert.equal ( matches ( 'foo.js\\  ', 'foo.js ' ), true );
  assert.equal ( matches ( 'd*p/foo.js', 'DeEp/FoO.jS' ), true );
  assert.equal ( matches ( 'd*p/foo.js', 'DeEp/FoO.jS', true ), false );

});

test ( 'recursive and anchored patterns preserve their scope', () => {

  assert.equal ( matches ( 'foo.js', 'foo.js' ), true );
  assert.equal ( matches ( 'foo.js', 'deep/foo.js' ), true );
  assert.equal ( matches ( '/foo.js', 'foo.js' ), true );
  assert.equal ( matches ( '/foo.js', 'deep/foo.js' ), false );
  assert.equal ( matches ( 'deep/deeper', 'deep/deeper/foo.js' ), true );
  assert.equal ( matches ( 'deep/deeper', 'other/deep/deeper/foo.js' ), false );
  assert.equal ( matches ( 'deep/**', 'deep/foo.js' ), true );
  assert.equal ( matches ( 'deep/**', 'deep/deeper/foo.js' ), true );
  assert.equal ( matches ( '**/deep', 'deep/foo.js' ), true );
  assert.equal ( matches ( '**/deep/**.js', 'deep/foo.js' ), true );
  assert.equal ( matches ( '**/deep/**.js', 'deep/deeper/foo.txt' ), false );
  assert.equal ( matches ( '**/**/**', 'bar.js' ), true );

});

test ( 'negation follows original same-file and multi-file ordering', () => {

  assert.equal ( matches ( 'foo.js\n!foo.js', 'foo.js' ), false );
  assert.equal ( matches ( 'foo.js\n!/foo.js', 'foo.js' ), false );
  assert.equal ( matches ( 'foo.js\n!/foo.js', 'deep/foo.js' ), true );

  assert.equal ( matches ( ['foo.js', '!foo.js'], 'foo.js' ), true );
  assert.equal ( matches ( ['foo.js\n!foo.js', 'foo.js'], 'foo.js' ), true );
  assert.equal ( matches ( ['foo.js\n!foo.js', 'bar.js'], 'foo.js' ), false );
  assert.equal ( matches ( ['deep', '!deep/foo.js'], 'deep/foo.js' ), true );
  assert.equal ( matches ( ['deep\n!deep', 'deep/foo.js'], 'deep/foo.js' ), true );

});

test ( 'directory-only patterns use explicit and inferred directory information', () => {

  assert.equal ( matches ( 'build/', 'build/foo.js' ), true );
  assert.equal ( matches ( 'build/', 'build' ), false );
  assert.equal ( matches ( 'build/', 'build', false, true ), true );
  assert.equal ( matches ( 'build/', 'deep/build', false, true ), true );
  assert.equal ( matches ( 'build', 'build' ), true );
  assert.equal ( matches ( '/build/', 'deep/build/foo.js' ), false );
  assert.equal ( matches ( '**/logs/', 'src/logs/debug.log' ), true );
  assert.equal ( matches ( '**/logs/', 'src/logs', false, false ), false );
  assert.equal ( matches ( '**/logs/', 'src/logs', false, true ), true );
  assert.equal ( matches ( 'foo/\nfoo', 'foo' ), true );
  assert.equal ( matches ( 'foo/\nfoo/bar', 'foo', false, false ), false );
  assert.equal ( matches ( 'foo/\nfoo/bar', 'foo', false, true ), true );

});

test ( 'the batch method has the same results as individual calls', () => {

  const ignore = fastIgnore ( 'build/\n*.log' );
  const paths = ['build', 'build/index.js', 'src/app.log', 'src/app.js'];
  const directories = [true, false, false, false];
  const expected = paths.map ( (path, index) => ignore ( path, {isDirectory: directories[index]} ) );

  assert.deepEqual ( ignore.batch ( paths, {isDirectory: directories} ), expected );
  assert.deepEqual ( ignore.batch ( paths, {isDirectory: false} ), paths.map ( path => ignore ( path ) ) );

});
