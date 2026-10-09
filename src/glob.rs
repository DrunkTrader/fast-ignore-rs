use crate::casefold;
use regress::Regex;

// The fast paths and regex grammar follow fast-ignore 2.0.0, including non-Unicode
// JS RegExp behavior. UTF-16 retains lone surrogates and '?' matches one code unit.
pub enum Glob {
    Any,
    Literal {
        text: Vec<u16>,
        kind: Kind,
        sensitive: bool,
    },
    Regex(Regex),
}

pub enum Kind {
    Exact,
    Prefix,
    Suffix,
}

fn static_unit(c: u16) -> bool {
    matches!(c, 32 | 45..=57 | 65..=90 | 95 | 97..=122)
}

fn ascii_fold(c: u16) -> u16 {
    if (65..=90).contains(&c) {
        c + 32
    } else {
        c
    }
}

pub(crate) fn line_terminator(c: u16) -> bool {
    matches!(c, 10 | 13 | 0x2028 | 0x2029)
}

impl Glob {
    pub fn compile(pattern: &[u16], sensitive: bool) -> Result<Self, String> {
        if !pattern.is_empty() && pattern.iter().all(|&c| c == 42) {
            return Ok(Self::Any);
        }
        let literal = if pattern.iter().copied().all(static_unit) {
            Some((pattern, Kind::Exact))
        } else {
            let first = pattern
                .iter()
                .position(|&c| c != 42)
                .unwrap_or(pattern.len());
            let last = pattern.iter().rposition(|&c| c != 42).map_or(0, |i| i + 1);
            if first > 0 && pattern[first..].iter().copied().all(static_unit) {
                Some((&pattern[first..], Kind::Suffix))
            } else if last < pattern.len() && pattern[..last].iter().copied().all(static_unit) {
                Some((&pattern[..last], Kind::Prefix))
            } else {
                None
            }
        };
        if let Some((text, kind)) = literal {
            return Ok(Self::Literal {
                text: text.to_vec(),
                kind,
                sensitive,
            });
        }

        let source = translate(pattern, sensitive)?;
        Regex::from_unicode(source.iter().map(|&c| u32::from(c)), "")
            .map(Self::Regex)
            .map_err(|e| format!("SyntaxError: Invalid regular expression: {e}"))
    }

    pub fn matches(&self, segment: &[u16]) -> bool {
        match self {
            Self::Any => true,
            Self::Literal {
                text,
                kind,
                sensitive,
                ..
            } => {
                if segment.len() < text.len() {
                    return false;
                }
                let candidate = match kind {
                    Kind::Exact if segment.len() != text.len() => return false,
                    Kind::Exact | Kind::Prefix => &segment[..text.len()],
                    Kind::Suffix => &segment[segment.len() - text.len()..],
                };
                if *sensitive {
                    candidate == text
                } else {
                    candidate
                        .iter()
                        .zip(text)
                        .all(|(&a, &b)| ascii_fold(a) == ascii_fold(b))
                }
            }
            Self::Regex(regex) => regex.find_from_ucs2(segment, 0).next().is_some(),
        }
    }
}

fn escape(c: u16) -> bool {
    b"$.*+?^(){}[]|".contains(&(c as u8)) && c < 128
}

// Port of the ordered grammex alternatives, not a general-purpose glob parser.
fn translate(pattern: &[u16], sensitive: bool) -> Result<Vec<u16>, String> {
    let mut source = vec![94]; // ^
    let mut i = 0;
    let mut backtrack_max = 0;
    while i < pattern.len() {
        let c = pattern[i];
        match c {
            42 => {
                while pattern.get(i) == Some(&42) {
                    i += 1;
                }
                source.extend([46, 42]); // .*
            }
            63 => {
                source.extend([91, 94, 47, 93]);
                i += 1;
            } // [^/]
            91 => {
                if let Some((end, class)) = class(pattern, i) {
                    source.extend(if sensitive {
                        class
                    } else {
                        casefold::class(class)?
                    });
                    i = end;
                } else {
                    backtrack_max = pattern.len();
                    source.extend([92, 91]);
                    i += 1;
                }
            }
            92 if pattern.get(i + 1).is_some_and(|&c| !line_terminator(c)) => {
                source.extend_from_slice(&pattern[i..i + 2]);
                i += 2;
            }
            c if line_terminator(c) => {
                return Err(format!("Failed to parse at index {}", i.max(backtrack_max)))
            }
            c => {
                if !sensitive && c != 92 {
                    casefold::literal(c, &mut source);
                } else {
                    if escape(c) {
                        source.push(92);
                    }
                    source.push(c);
                }
                i += 1;
            }
        }
    }
    source.push(36); // $
    Ok(source)
}

fn class(pattern: &[u16], opening: usize) -> Option<(usize, Vec<u16>)> {
    let mut i = opening + 1;
    let mut output = vec![91];
    if matches!(pattern.get(i), Some(33 | 94)) {
        output.push(94);
        i += 1;
    }
    while let Some(&c) = pattern.get(i) {
        if c == 93 {
            output.push(93);
            return Some((i + 1, output));
        }
        if c == 92 && pattern.get(i + 1).is_some_and(|&c| !line_terminator(c)) {
            output.extend_from_slice(&pattern[i..i + 2]);
            i += 2;
        } else {
            if escape(c) {
                output.push(92);
            }
            output.push(c);
            i += 1;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    fn matches(pattern: &str, path: &str, sensitive: bool) -> bool {
        Glob::compile(&pattern.encode_utf16().collect::<Vec<_>>(), sensitive)
            .unwrap()
            .matches(&path.encode_utf16().collect::<Vec<_>>())
    }

    #[test]
    fn javascript_regex_and_fast_path_semantics() {
        assert!(!matches("?", "😀", false));
        assert!(matches("??", "😀", false));
        assert!(!matches("k", "K", false));
        assert!(!matches("[s]", "ſ", false));
        assert!(matches("[é]", "É", false));
        assert!(!matches("[]", "x", false));
        assert!(matches("[!]", "x", false));
        assert!(matches("[", "[", false));
        assert!(matches("*", "\n", false));
        assert!(matches("*x", "\nx", false));
        assert!(!matches("a*b", "a\nb", false));
        assert!(matches("foo\\", "foo$bar", false));
        assert!(Glob::compile(&[0xd800], false).unwrap().matches(&[0xd800]));
    }
}
