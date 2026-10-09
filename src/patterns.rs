use regress::Regex;
use std::sync::OnceLock;

pub struct Pattern {
    pub content: Vec<u16>,
    pub negative: bool,
    pub directory: bool,
}

// ECMAScript WhiteSpace + LineTerminator, not Rust's Unicode White_Space.
fn whitespace(c: u16) -> bool {
    matches!(c, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}

pub fn parse(input: &[u16]) -> Vec<Pattern> {
    input
        .split(|&c| c == 10 || c == 13)
        .filter_map(|line| {
            if line.iter().copied().all(whitespace) || line.first() == Some(&35) {
                return None;
            }
            let negative = line.first() == Some(&33);
            let directory = line.last() == Some(&47);
            let content = &line[usize::from(negative)..line.len() - usize::from(directory)];
            Some(Pattern {
                content: normalize(content),
                negative,
                directory,
            })
        })
        .collect()
}

fn normalize(input: &[u16]) -> Vec<u16> {
    static TRAILING: OnceLock<Regex> = OnceLock::new();
    static GLOBSTARS: OnceLock<Regex> = OnceLock::new();
    let trailing = TRAILING.get_or_init(|| Regex::new(r"((?:\\\s)*)\s*$").unwrap());
    let stars = GLOBSTARS.get_or_init(|| Regex::new(r"(^|/)\*\*/(?:\*\*(/|$))+").unwrap());
    let found = trailing.find_from_ucs2(input, 0).next().unwrap();
    let mut content = input[..found.range.start].to_vec();
    if let Some(range) = &found.captures[0] {
        content.extend(input[range.clone()].iter().copied().filter(|&c| c != 92));
    }

    let mut unescaped = Vec::with_capacity(content.len());
    let mut i = 0;
    while i < content.len() {
        if content[i] == 92
            && content
                .get(i + 1)
                .is_some_and(|c| ![42, 63, 91, 93].contains(c))
        {
            i += 1;
        }
        unescaped.push(content[i]);
        i += 1;
    }

    let mut normalized = Vec::with_capacity(unescaped.len() + 3);
    let mut last = 0;
    for found in stars.find_from_ucs2(&unescaped, 0) {
        normalized.extend_from_slice(&unescaped[last..found.range.start]);
        if let Some(range) = &found.captures[0] {
            normalized.extend_from_slice(&unescaped[range.clone()]);
        }
        normalized.extend([42, 42]);
        if let Some(range) = &found.captures[1] {
            normalized.extend_from_slice(&unescaped[range.clone()]);
        }
        last = found.range.end;
    }
    normalized.extend_from_slice(&unescaped[last..]);
    if normalized.first() == Some(&47) {
        normalized.remove(0);
    } else if !normalized.starts_with(&[42, 42, 47])
        && !normalized[..normalized.len().saturating_sub(1)].contains(&47)
    {
        normalized.splice(0..0, [42, 42, 47]);
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn whitespace_flags_are_taken_before_normalization() {
        let inputs = ["foo.js\\  ", "**/**/**", "dir/ ", "\\#foo", "\u{feff}"];
        let expected = [
            Some("**/foo.js "),
            Some("**/**"),
            Some("**/dir/"),
            Some("**/#foo"),
            None,
        ];
        for (input, expected) in inputs.into_iter().zip(expected) {
            let parsed = parse(&input.encode_utf16().collect::<Vec<_>>());
            assert_eq!(
                parsed
                    .first()
                    .map(|p| String::from_utf16(&p.content).unwrap()),
                expected.map(str::to_owned)
            );
            assert!(parsed.iter().all(|p| !p.directory));
        }
    }
}
