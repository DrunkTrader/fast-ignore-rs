import assert from 'node:assert/strict';
import test from 'node:test';
import original from 'fast-ignore-original';
import fastIgnore from '../dist/index.js';

const rules = ['', '#comment', ' #not-comment', 'foo', 'foo/', '/foo', '!foo', '*', '**', '***', 'a?b', '?', '??', '[a-z]', '[!a]', '[]', '[!]', '[', '[a', '[a-?]', '[a&&b]', '[a--b]', '[z-a]', 'a*b', '*a', 'a*', 'a**b', 'a/**/b', '**/**/**/a', '/a//b', '\\#foo', '\\!foo', '\\*', '\\?', '\\[', 'foo\\', 'foo\\  ', 'foo/ ', '\uFEFF', '\u0085', 'a\u2028b', '[\u2028]', 'é', '[é]', '[s]', 'k', '😀', '[😀]', '\ud800', '\udfff'];
const paths = ['', 'foo', 'FOO', 'foo/', 'foo//', '/foo', './foo', '../foo', 'a/foo', 'a/foo/b', 'a\\foo', 'a\\foo/b', 'foo$tail', 'foo ', 'a', 'b', 'ab', 'a/b', 'a//b', 'a/c/b', 'a\\c\\b', '*', '?', '[', '[a', ']', '-', '&', '#foo', '!foo', ' #not-comment', '\n', '\r', '\u2028', '\u2029', 'a\nb', '\na', 'a\n', 'É', 'é', 'K', 'ſ', 's', 'k', '😀', '\ud800', '\udfff', '\ufffd', '\uFEFF', '\u0085'];

function outcome(fn) {
  try { return {value: fn()}; } catch (error) { return {error: error.constructor.name}; }
}

function compare(patterns, options) {
  const a = outcome(() => original(patterns, options));
  const b = outcome(() => fastIgnore(patterns, options));
  assert.equal(b.error, a.error, JSON.stringify({patterns, options}));
  if (a.error) return;
  for (const isDirectory of [false, true]) {
    const expected = paths.map(path => a.value(path, {isDirectory}));
    const actual = paths.map(path => b.value(path, {isDirectory}));
    assert.deepEqual(actual, expected, JSON.stringify({patterns, options, isDirectory}));
    assert.deepEqual(b.value.batch(paths, {isDirectory}), expected);
  }
}

test('differential grammar, Unicode, separators, and error behavior', () => {
  for (const caseSensitive of [false, true]) {
    for (const rule of rules) compare(rule, {caseSensitive});
  }
});

test('seeded multi-rule/tier differential coverage and prefix-cache invalidation', () => {
  let seed = 0xface;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let i = 0; i < 500; i++) {
    const selected = Array.from({length: 1 + random(8)}, () => rules[random(rules.length)]);
    compare(i % 2 ? selected : selected.join(i % 3 ? '\n' : '\r\n'), {caseSensitive: i % 3 === 0});
  }
});

test('invalid typed inputs throw synchronously; empty matchers retain short circuit', () => {
  for (const invalid of [undefined, null, 1, {}, [null], ['foo', 2]]) {
    assert.deepEqual(outcome(() => fastIgnore(invalid)), outcome(() => original(invalid)));
  }
  for (const pattern of ['', '#comment', [], ['\uFEFF'], 'foo']) {
    for (const options of [undefined, null, {}, {caseSensitive: null}]) {
      const a = outcome(() => original(pattern, options));
      const b = outcome(() => fastIgnore(pattern, options));
      assert.equal(b.error, a.error);
      if (!a.error) for (const path of [undefined, null, 1, {}]) {
        assert.deepEqual(outcome(() => b.value(path)), outcome(() => a.value(path)));
      }
    }
  }
  assert.throws(() => fastIgnore('x').batch(['x'], {isDirectory: []}), RangeError);
});
