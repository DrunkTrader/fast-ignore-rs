use regress::Regex;
use std::{collections::BTreeMap, sync::OnceLock};

// Legacy (non-/u) ECMAScript Canonicalize: uppercase only when the result is a
// single UTF-16 unit, and never fold a non-ASCII unit into ASCII.
fn canonical(c: u16) -> u16 {
    let Some(ch) = char::from_u32(u32::from(c)) else {
        return c;
    };
    let mut upper = ch.to_uppercase();
    let first = upper.next().unwrap() as u32;
    if upper.next().is_some() || first > 0xffff || (c >= 128 && first < 128) {
        c
    } else {
        first as u16
    }
}

fn groups() -> &'static BTreeMap<u16, Vec<u16>> {
    static GROUPS: OnceLock<BTreeMap<u16, Vec<u16>>> = OnceLock::new();
    GROUPS.get_or_init(|| {
        let mut groups = BTreeMap::new();
        for c in 0..=u16::MAX {
            let upper = canonical(c);
            if upper != c {
                groups.entry(upper).or_insert_with(|| vec![upper]).push(c);
            }
        }
        groups
    })
}

fn escaped(c: u16, out: &mut Vec<u16>) {
    out.extend(format!("\\u{c:04x}").encode_utf16());
}

pub fn literal(c: u16, out: &mut Vec<u16>) {
    if let Some(group) = groups().get(&canonical(c)) {
        out.push(91);
        for &c in group {
            escaped(c, out);
        }
        out.push(93);
    } else {
        if c < 128 && b"$.*+?^(){}[]|".contains(&(c as u8)) {
            out.push(92);
        }
        out.push(c);
    }
}

pub fn class(source: Vec<u16>) -> Result<Vec<u16>, String> {
    let negated = source.get(1) == Some(&94);
    let mut positive = source.clone();
    if negated {
        positive.remove(1);
    }
    let regex = Regex::from_unicode(positive.iter().map(|&c| u32::from(c)), "")
        .map_err(|e| format!("SyntaxError: Invalid regular expression: {e}"))?;
    let mut extra = Vec::new();
    for group in groups().values() {
        if group
            .iter()
            .any(|&c| regex.find_from_ucs2(&[c], 0).next().is_some())
        {
            for &c in group {
                escaped(c, &mut extra);
            }
        }
    }
    if extra.is_empty() {
        return Ok(source);
    }
    if negated {
        let mut out: Vec<u16> = "(?![".encode_utf16().collect();
        out.extend(extra);
        out.extend("])".encode_utf16());
        out.extend(source);
        Ok(out)
    } else {
        let mut out: Vec<u16> = "(?:".encode_utf16().collect();
        out.extend(source);
        out.extend("|[".encode_utf16());
        out.extend(extra);
        out.extend("])".encode_utf16());
        Ok(out)
    }
}
