use crate::{glob::Glob, patterns::parse};

struct Node {
    id: Vec<u16>,
    directory: bool,
    globstar: bool,
    negative: bool,
    strength: i64,
    tier: usize,
    matcher: Glob,
    children: Vec<usize>,
}

#[derive(Default)]
struct Cache {
    segment: Vec<u16>,
    directory: bool,
    states: Vec<usize>,
    negative: bool,
    strength: i64,
}

pub struct Engine {
    nodes: Vec<Node>,
    cache: Vec<Cache>,
    scratch: Vec<usize>,
    empty: bool,
}

impl Engine {
    pub fn compile(ignores: &[&[u16]], sensitive: bool) -> Result<Self, String> {
        let mut nodes = vec![Node {
            id: Vec::new(),
            directory: false,
            globstar: false,
            negative: false,
            strength: -1,
            tier: 0,
            matcher: Glob::Any,
            children: Vec::new(),
        }];
        let mut strength = 0;
        let mut tier = 0;
        for input in ignores {
            let patterns = parse(input);
            if patterns.is_empty() {
                continue;
            }
            for pattern in patterns {
                let mut parent = 0;
                let mut segments = pattern.content.split(|&c| c == 47).peekable();
                while let Some(id) = segments.next() {
                    let terminal = segments.peek().is_none();
                    let directory = terminal && pattern.directory;
                    let node_strength = if terminal {
                        let s = strength;
                        strength += 1;
                        s
                    } else {
                        -1
                    };
                    let existing = nodes[parent]
                        .children
                        .iter()
                        .copied()
                        .find(|&index| nodes[index].id == id);
                    parent = if let Some(index) = existing {
                        let node = &mut nodes[index];
                        if (tier == node.tier && node_strength >= node.strength)
                            || (tier > node.tier && (node.strength < 0 || node.negative))
                        {
                            node.directory &= directory;
                            node.negative = pattern.negative;
                            node.strength = node_strength;
                            node.tier = tier;
                        }
                        index
                    } else {
                        let index = nodes.len();
                        nodes[parent].children.push(index);
                        nodes.push(Node {
                            id: id.to_vec(),
                            directory,
                            globstar: id == [42, 42],
                            negative: pattern.negative,
                            strength: node_strength,
                            tier,
                            matcher: Glob::compile(id, sensitive)?,
                            children: Vec::new(),
                        });
                        index
                    };
                }
            }
            tier += 1;
        }
        Ok(Self {
            nodes,
            cache: Vec::new(),
            scratch: Vec::new(),
            empty: tier == 0,
        })
    }

    pub fn empty(&self) -> bool {
        self.empty
    }

    pub fn matches(&mut self, path: &[u16], directory: bool) -> bool {
        if self.empty {
            return false;
        }
        let sep = if path.contains(&47) { 47 } else { 92 };
        let mut start = 0;
        let mut nth = 0;
        let mut cacheable = true;
        while start < path.len() {
            let end = path[start..]
                .iter()
                .position(|&c| c == sep)
                .map_or(path.len(), |offset| start + offset);
            let segment = &path[start..end];
            start = end + 1;
            let is_directory = start < path.len() || directory;
            if segment.is_empty() {
                continue;
            }

            let hit = cacheable
                && nth + 1 < self.cache.len()
                && self.cache[nth].segment == segment
                && self.cache[nth].directory == is_directory;
            cacheable = hit;
            if !hit {
                let states = if nth == 0 {
                    &[0][..]
                } else {
                    &self.cache[nth - 1].states
                };
                self.scratch.clear();
                let mut strength = -1;
                let mut negative = false;
                for &node in states {
                    tick(
                        &self.nodes,
                        node,
                        segment,
                        is_directory,
                        &mut self.scratch,
                        &mut strength,
                        &mut negative,
                    );
                }
                if strength >= 0 && !negative {
                    return true;
                }
                if self.scratch.is_empty() {
                    return false;
                }
                if nth == self.cache.len() {
                    self.cache.push(Cache::default());
                }
                let cached = &mut self.cache[nth];
                cached.segment.clear();
                cached.segment.extend_from_slice(segment);
                cached.directory = is_directory;
                cached.strength = strength;
                cached.negative = negative;
                std::mem::swap(&mut cached.states, &mut self.scratch);
            }
            let cached = &self.cache[nth];
            if cached.strength >= 0 && !cached.negative {
                return true;
            }
            if cached.states.is_empty() {
                return false;
            }
            nth += 1;
        }
        false
    }
}

fn tick(
    nodes: &[Node],
    index: usize,
    segment: &[u16],
    directory: bool,
    states: &mut Vec<usize>,
    strength: &mut i64,
    negative: &mut bool,
) {
    let node = &nodes[index];
    for &index in &node.children {
        let child = &nodes[index];
        if !child.matcher.matches(segment) {
            continue;
        }
        if child.strength >= *strength && (!child.directory || directory) {
            *strength = child.strength;
            *negative = child.negative;
        }
        if !child.children.is_empty() {
            if child.globstar {
                tick(nodes, index, segment, directory, states, strength, negative);
            } else {
                states.push(index);
            }
        }
    }
    if node.globstar {
        if node.strength >= *strength && (!node.directory || directory) {
            *strength = node.strength;
            *negative = node.negative;
        }
        states.push(index);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(patterns: &[&str]) -> Engine {
        let inputs: Vec<Vec<u16>> = patterns
            .iter()
            .map(|s| s.encode_utf16().collect())
            .collect();
        Engine::compile(&inputs.iter().map(|s| &s[..]).collect::<Vec<_>>(), false).unwrap()
    }
    fn matches(engine: &mut Engine, path: &str, dir: bool) -> bool {
        engine.matches(&path.encode_utf16().collect::<Vec<_>>(), dir)
    }

    #[test]
    fn ordered_tiers_and_duplicate_directory_flags() {
        assert!(matches(&mut engine(&["foo", "!foo"]), "foo", false));
        assert!(!matches(&mut engine(&["foo\n!foo"]), "foo", false));
        assert!(matches(&mut engine(&["foo\n!foo", "foo"]), "foo", false));
        assert!(matches(&mut engine(&["foo\n!foo/"]), "foo", false) == false);
        assert!(matches(&mut engine(&["foo/\nfoo"]), "foo", false));
        // Different trie branches can override across tiers (an upstream quirk).
        assert!(!matches(&mut engine(&["*.js", "!foo.js"]), "foo.js", false));
    }

    #[test]
    fn separator_inference_and_cache_reuse() {
        let mut m = engine(&["dir/\n**/nested/*.js"]);
        for _ in 0..3 {
            for (path, dir, expected) in [
                ("dir/", false, false),
                ("dir//", false, true),
                ("dir", true, true),
                ("dir", false, false),
                ("a/nested/x.js", false, true),
                ("a/nested/x.txt", false, false),
                ("a\\nested\\x.js", false, true),
                ("a/nested\\x.js", false, false),
            ] {
                assert_eq!(matches(&mut m, path, dir), expected, "{path}");
            }
        }
        assert!(engine(&["#comment"]).empty());
    }

    #[test]
    fn evaluate_ignore_crate_compatibility() {
        // ignore is a useful Git-ignore implementation, but replacing the trie
        // with it would change observable behavior. Keep executable evidence.
        let mut builder = ignore::gitignore::GitignoreBuilder::new("");
        builder.case_insensitive(true).unwrap();
        builder.add_line(None, "foo").unwrap();
        builder.add_line(None, "!foo/").unwrap();
        let standard = builder.build().unwrap();
        assert!(standard.matched("foo", false).is_ignore());
        assert!(!matches(&mut engine(&["foo\n!foo/"]), "foo", false));

        let mut builder = ignore::gitignore::GitignoreBuilder::new("");
        builder.add_line(None, "?").unwrap();
        // globset's '?' is byte-oriented, the original is UTF-16 oriented.
        assert!(!builder.build().unwrap().matched("é", false).is_ignore());
        assert!(matches(&mut engine(&["?"]), "é", false));
    }
}
