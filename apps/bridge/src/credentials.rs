//! Credential store: API key never touches the web app, worker, logs, or repo.
//! macOS → Keychain (GenericPassword). Other platforms (CI/dev) → mock store.

pub trait CredentialStore: Send + Sync {
    fn store_key(&self, key: &str) -> Result<(), String>;
    fn load_key(&self) -> Result<Option<String>, String>;
    fn delete_key(&self) -> Result<(), String>;
}

#[cfg(target_os = "macos")]
pub struct KeychainCredentialStore;

#[cfg(target_os = "macos")]
impl CredentialStore for KeychainCredentialStore {
    fn store_key(&self, key: &str) -> Result<(), String> {
        use security_framework::os::macos::keychain::SecKeychain;
        let kc = SecKeychain::default().map_err(|e| e.to_string())?;
        kc.set_generic_password("patent-bridge", "deepseek-api-key", key.as_bytes())
            .map_err(|e| e.to_string())
    }

    fn load_key(&self) -> Result<Option<String>, String> {
        use security_framework::os::macos::keychain::SecKeychain;
        let kc = SecKeychain::default().map_err(|e| e.to_string())?;
        match kc.find_generic_password("patent-bridge", "deepseek-api-key") {
            Ok((password, _)) => {
                let bytes = password.as_ref().to_vec();
                String::from_utf8(bytes).map(Some).map_err(|e| e.to_string())
            }
            Err(_) => Ok(None),
        }
    }

    fn delete_key(&self) -> Result<(), String> {
        use security_framework::os::macos::keychain::SecKeychain;
        use security_framework::os::macos::keychain_item::SecKeychainItem;
        let kc = SecKeychain::default().map_err(|e| e.to_string())?;
        match kc.find_generic_password("patent-bridge", "deepseek-api-key") {
            Ok((_, item)) => {
                SecKeychainItem::delete(item);
                Ok(())
            }
            Err(_) => Ok(()),
        }
    }
}

/// In-memory store for tests and non-macOS builds (CI). Not for production use.
pub struct MockCredentialStore(pub std::sync::Mutex<Option<String>>);

impl Default for MockCredentialStore {
    fn default() -> Self {
        Self(std::sync::Mutex::new(None))
    }
}

impl CredentialStore for MockCredentialStore {
    fn store_key(&self, key: &str) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(key.to_string());
        Ok(())
    }
    fn load_key(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn delete_key(&self) -> Result<(), String> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn default_store() -> Box<dyn CredentialStore> {
    Box::new(KeychainCredentialStore)
}

#[cfg(not(target_os = "macos"))]
pub fn default_store() -> Box<dyn CredentialStore> {
    Box::new(MockCredentialStore::default())
}
