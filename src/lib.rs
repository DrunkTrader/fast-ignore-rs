mod casefold;
mod engine;
mod glob;
mod patterns;

// Keeping Node bindings separate allows the engine tests to run without a Node host.
#[cfg(not(test))]
mod bindings {
    use crate::{engine::Engine, glob::Glob};
    use napi::{bindgen_prelude::Utf16String, Error, JsString, JsValue, Result};
    use napi_derive::napi;

    fn copy_utf16(path: &JsString, destination: &mut Vec<u16>) -> Result<()> {
        let value = path.value();
        let mut length = 0;
        napi::check_status!(unsafe {
            napi::sys::napi_get_value_string_utf16(
                value.env,
                value.value,
                std::ptr::null_mut(),
                0,
                &mut length,
            )
        })?;
        destination.resize(length + 1, 0);
        let mut written = 0;
        napi::check_status!(unsafe {
            napi::sys::napi_get_value_string_utf16(
                value.env,
                value.value,
                destination.as_mut_ptr(),
                destination.len(),
                &mut written,
            )
        })?;
        destination.truncate(written);
        Ok(())
    }

    #[napi]
    pub struct IgnoreMatcher {
        engine: Engine,
        input_utf16: Vec<u16>,
    }

    #[napi]
    impl IgnoreMatcher {
        #[napi(getter)]
        pub fn empty(&self) -> bool {
            self.engine.empty()
        }

        #[napi]
        pub fn matches(&mut self, path: JsString, is_directory: bool) -> Result<bool> {
            copy_utf16(&path, &mut self.input_utf16)?;
            Ok(self.engine.matches(&self.input_utf16, is_directory))
        }

        #[napi(js_name = "matchesBatch")]
        pub fn matches_batch(
            &mut self,
            paths: Vec<JsString>,
            directories: Option<Vec<bool>>,
        ) -> Result<Vec<bool>> {
            paths
                .iter()
                .enumerate()
                .map(|(i, path)| {
                    copy_utf16(path, &mut self.input_utf16)?;
                    Ok(self.engine.matches(
                        &self.input_utf16,
                        directories
                            .as_ref()
                            .and_then(|d| d.get(i))
                            .copied()
                            .unwrap_or(false),
                    ))
                })
                .collect()
        }
    }

    #[napi]
    pub fn create_matcher(
        ignores: Vec<Utf16String>,
        case_sensitive: bool,
    ) -> Result<IgnoreMatcher> {
        let inputs: Vec<&[u16]> = ignores.iter().map(|s| &s[..]).collect();
        Ok(IgnoreMatcher {
            engine: Engine::compile(&inputs, case_sensitive).map_err(Error::from_reason)?,
            input_utf16: Vec::new(),
        })
    }

    // Internal binding for the original segment-level tests; not a package export.
    #[napi]
    pub struct GlobMatcher {
        glob: Glob,
    }

    #[napi]
    impl GlobMatcher {
        #[napi(constructor)]
        pub fn new(pattern: Utf16String, case_sensitive: bool) -> Result<Self> {
            Ok(Self {
                glob: Glob::compile(&pattern, case_sensitive).map_err(Error::from_reason)?,
            })
        }

        #[napi]
        pub fn matches(&self, segment: Utf16String) -> bool {
            self.glob.matches(&segment)
        }
    }
}
