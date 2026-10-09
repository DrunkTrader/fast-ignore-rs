// All assertions from fabiospampinato/fast-ignore test/index.js at 9adbb13.
// MIT Copyright (c) 2023-present Fabio Spampinato. See ../LICENSE.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import fastIgnore from '../dist/index.js';
import original from 'fast-ignore-original';
const {GlobMatcher} = createRequire(import.meta.url)('../fast-ignore-rs-loader.cjs');

const globCases = [
  ['', '', true], ['', 'a', false],
  ['foo', 'foo', true], ['foo', 'fo2', false], ['foo', 'foo2', false],
  ['\\?', '', false], ['\\?', 'a', false], ['\\?', '?', true],
  ['?', '', false], ['?', '/', false], ['?', '\\', true], ['?', 'a', true], ['?', 'aaa', false],
  ['foo?bar', 'foobar', false], ['foo?bar', 'foo/bar', false], ['foo?bar', 'foo\\bar', true], ['foo?bar', 'fooabar', true], ['foo?bar', 'fooaaabar', false],
  ['\\*', '', false], ['\\*', 'a', false], ['\\*', '*', true],
  ['*', '', true], ['*', 'a', true], ['*', 'aaa', true],
  ['foo*bar', 'foobar', true], ['foo*bar', 'fooabar', true], ['foo*bar', 'fooaaabar', true],
  ['foo**bar', 'foobar', true], ['foo**bar', 'fooabar', true], ['foo**bar', 'fooaaabar', true],
  ['foo[a-z]bar', 'fooabar', true], ['foo[a-z]bar', 'foozbar', true], ['foo[a-z]bar', 'fooAbar', false], ['foo[a-z]bar', 'fooZbar', false], ['foo[a-z]bar', 'fooaabar', false],
  ['foo[A-Z]bar', 'fooAbar', true], ['foo[A-Z]bar', 'fooZbar', true], ['foo[A-Z]bar', 'fooabar', false], ['foo[A-Z]bar', 'foozbar', false], ['foo[A-Z]bar', 'fooaabar', false],
  ['foo[0-5]bar', 'foo0bar', true], ['foo[0-5]bar', 'foo5bar', true], ['foo[0-5]bar', 'foo6bar', false], ['foo[0-5]bar', 'foo7bar', false], ['foo[0-5]bar', 'foo00bar', false],
  ['foo[0-z]bar', 'fooabar', true], ['foo[0-z]bar', 'fooAbar', true], ['foo[0-z]bar', 'foo9bar', true], ['foo[0-z]bar', 'foo>bar', true], ['foo[0-z]bar', 'fooaabar', false],
  ['foo[a-zA-Z0-9]bar', 'fooabar', true], ['foo[a-zA-Z0-9]bar', 'fooAbar', true], ['foo[a-zA-Z0-9]bar', 'foo9bar', true], ['foo[a-zA-Z0-9]bar', 'foo>bar', false], ['foo[a-zA-Z0-9]bar', 'fooaabar', false],
  ['foo[abc]bar', 'fooabar', true], ['foo[abc]bar', 'foobbar', true], ['foo[abc]bar', 'fooAbar', false], ['foo[abc]bar', 'fooBbar', false], ['foo[abc]bar', 'fooaabar', false],
  ['foo[!abc]bar', 'fooabar', false], ['foo[!abc]bar', 'foobbar', false], ['foo[!abc]bar', 'fooAbar', true], ['foo[!abc]bar', 'fooBbar', true], ['foo[!abc]bar', 'fooaabar', false],
  ['foo[^abc]bar', 'fooabar', false], ['foo[^abc]bar', 'foobbar', false], ['foo[^abc]bar', 'fooAbar', true], ['foo[^abc]bar', 'fooBbar', true], ['foo[^abc]bar', 'fooaabar', false],
  ['(foo|bar)', '(foo|bar)', true], ['(foo|bar)', 'foo', false], ['(foo|bar)', 'bar', false]
];

const singleTier = [
  ['foo.js', 'foo.js', true], ['foo.js', 'deep/foo.js', true], ['foo.js', 'deep/deeper/foo.js', true], ['foo.js', 'bar.js', false],
  ['/foo.js', 'foo.js', true], ['/foo.js', 'deep/foo.js', false], ['/foo.js', 'deep/deeper/foo.js', false], ['/foo.js', 'bar.js', false],
  ['foo.js\n!foo.js', 'foo.js', false], ['foo.js\n!foo.js', 'deep/foo.js', false], ['foo.js\n!foo.js', 'deep/deeper/foo.js', false], ['foo.js\n!foo.js', 'bar.js', false],
  ['foo.js\n!/foo.js', 'foo.js', false], ['foo.js\n!/foo.js', 'deep/foo.js', true], ['foo.js\n!/foo.js', 'deep/deeper/foo.js', true], ['foo.js\n!/foo.js', 'bar.js', false],
  ['#foo.js', 'foo.js', false], ['#foo.js', 'deep/foo.js', false], ['#foo.js', 'deep/deeper/foo.js', false], ['#foo.js', 'bar.js', false], ['#foo.js', '#foo.js', false],
  ['\\#foo.js', 'foo.js', false], ['\\#foo.js', 'deep/foo.js', false], ['\\#foo.js', 'deep/deeper/foo.js', false], ['\\#foo.js', 'bar.js', false], ['\\#foo.js', '#foo.js', true],
  ['\\!foo.js', 'foo.js', false], ['\\!foo.js', 'deep/foo.js', false], ['\\!foo.js', 'deep/deeper/foo.js', false], ['\\!foo.js', 'bar.js', false], ['\\!foo.js', '!foo.js', true],
  ['\\f\\o\\o\\.\\j\\s', 'foo.js', true],
  ['\\*', '*', true], ['\\*', 'foo', false], ['\\*\\*', '**', true], ['\\*\\*', 'foo', false], ['\\?', '?', true], ['\\?', 'a', false],
  ['\\[a-z]', '[a-z]', true], ['\\[a-z]', 'a', false], ['\\[a-z\\]', '[a-z]', true], ['\\[a-z\\]', 'a', false],
  ['foo.js  ', 'foo.js', true], ['foo.js  ', 'foo.js ', false], ['foo.js\\  ', 'foo.js', false], ['foo.js\\  ', 'foo.js ', true],
  ['deep', 'foo.js', false], ['deep', 'deep/foo.js', true], ['deep', 'deep/deeper/foo.js', true], ['deep', 'bar.js', false], ['deep\n!deep/foo.js', 'deep/foo.js', true],
  ['deep/deeper', 'deep/deeper/foo.js', true], ['deep/deeper', 'other/deep/deeper/foo.js', false], ['/deep/deeper', 'deep/deeper/foo.js', true], ['/deep/deeper', 'other/deep/deeper/foo.js', false], ['/deep/deeper/', 'deep/deeper/foo.js', true], ['/deep/deeper/', 'other/deep/deeper/foo.js', false],
  ['deep/**', 'foo.js', false], ['deep/**', 'deep/foo.js', true], ['deep/**', 'deep/deeper/foo.js', true], ['deep/**', 'bar.js', false],
  ['**/deep', 'foo.js', false], ['**/deep', 'deep/foo.js', true], ['**/deep', 'deep/deeper/foo.js', true], ['**/deep', 'bar.js', false],
  ['**/deep/**', 'foo.js', false], ['**/deep/**', 'deep/foo.js', true], ['**/deep/**', 'deep/deeper/foo.js', true], ['**/deep/**', 'bar.js', false],
  ['**/deep/**.js', 'foo.js', false], ['**/deep/**.js', 'deep/foo.js', true], ['**/deep/**.js', 'deep/deeper/foo.txt', false], ['**/deep/**.js', 'bar.js', false],
  ['**/**/**', 'foo.js', true], ['**/**/**', 'deep/foo.js', true], ['**/**/**', 'deep/deeper/foo.txt', true], ['**/**/**', 'deep/deeper/deepest/foo.txt', true], ['**/**/**', 'bar.js', true],
  ['d*p/foo.js', 'deep/foo.js', true, false], ['d*p/foo.js', 'DeEp/FoO.jS', true, false], ['d*p/foo.js', 'deep/foo.js', true, true], ['d*p/foo.js', 'DeEp/FoO.jS', false, true]
];

const multipleTiers = [
  [['foo.js', 'bar.js'], 'foo.js', true], [['foo.js', 'bar.js'], 'bar.js', true], [['foo.js', 'bar.js'], 'baz.js', false],
  [['foo.js', '!foo.js'], 'foo.js', true], [['foo.js', '!foo.js'], 'bar.js', false], [['foo.js', '!foo.js'], 'baz.js', false],
  [['foo.js\n!foo.js', 'foo.js'], 'foo.js', true], [['foo.js\n!foo.js', 'foo.js'], 'bar.js', false], [['foo.js\n!foo.js', 'foo.js'], 'baz.js', false],
  [['foo.js\n!foo.js', 'bar.js'], 'foo.js', false], [['foo.js\n!foo.js', 'bar.js'], 'bar.js', true], [['foo.js\n!foo.js', 'bar.js'], 'baz.js', false],
  [['deep\n!deep', 'deep/foo.js'], 'deep/foo.js', true], [['deep\n!deep', 'deep/foo.js'], 'deeper/deep/foo.js', false], [['deep\n!deep', 'deep/foo.js'], 'deeper/deep/bar.js', false],
  [['deep', 'deep/foo.js'], 'deep/foo.js', true], [['deep', 'deep/foo.js'], 'deeper/deep/foo.js', true], [['deep', 'deep/foo.js'], 'deeper/deep/bar.js', true],
  [['deep', '!deep/foo.js'], 'deep/foo.js', true], [['deep', '!deep/foo.js'], 'deeper/deep/foo.js', true], [['deep', '!deep/foo.js'], 'deeper/deep/bar.js', true]
];

const directories = [
  ['build/', 'build/foo.js', true], ['build/', 'deep/build/foo.js', true],
  ['build/', 'build', false], ['build/', 'build', false, false, false], ['build/', 'build', true, false, true], ['build/', 'deep/build', false, false, false], ['build/', 'deep/build', true, false, true],
  ['build', 'build', true], ['build', 'build', true, false, false], ['build', 'build', true, false, true],
  ['/build/', 'build/foo.js', true], ['/build/', 'build', false, false, false], ['/build/', 'build', true, false, true], ['/build/', 'deep/build/foo.js', false],
  ['**/logs/', 'logs/debug.log', true], ['**/logs/', 'logs', true, false, true], ['**/logs/', 'logs', false, false, false], ['**/logs/', 'src/logs/debug.log', true], ['**/logs/', 'src/logs', true, false, true], ['**/logs/', 'src/logs', false, false, false],
  ['foo\nfoo/', 'foo', true], ['foo\nfoo/', 'foo', true, false, false], ['foo\nfoo/', 'foo', true, false, true],
  ['foo/\nfoo', 'foo', true], ['foo/\nfoo', 'foo', true, false, false], ['foo/\nfoo', 'foo', true, false, true],
  ['foo/\nfoo/bar', 'foo', false], ['foo/\nfoo/bar', 'foo', false, false, false], ['foo/\nfoo/bar', 'foo', true, false, true]
];

test(`upstream glob corpus (${globCases.length} assertions)`, () => {
  for (const [pattern, segment, expected] of globCases) {
    assert.equal(new GlobMatcher(pattern, true).matches(segment), expected, JSON.stringify([pattern, segment]));
  }
});

for (const [name, cases] of Object.entries({singleTier, multipleTiers, directories})) {
  test(`upstream ${name} (${cases.length} assertions)`, () => {
    for (const [patterns, path, expected, caseSensitive, isDirectory] of cases) {
      const message = JSON.stringify({patterns, path, caseSensitive, isDirectory});
      assert.equal(original(patterns, {caseSensitive})(path, {isDirectory}), expected, `reference: ${message}`);
      assert.equal(fastIgnore(patterns, {caseSensitive})(path, {isDirectory}), expected, message);
    }
  });
}
