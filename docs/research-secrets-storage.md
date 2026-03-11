# Research: Hardening Secrets Storage with OS-Level Keychains

**Date:** 2026-03-11
**Status:** Research complete

## Current State

Money Monitor stores secrets in two modes:

### Standalone Mode (Linux/macOS server)

- Secrets in `.env` file loaded via `dotenv`
- `CREDENTIALS_MASTER_KEY` stored as **plaintext** in `.env`

### Electron Mode (Desktop)

- Secrets in `data/config.json` (permissions `0o600`)
- `CREDENTIALS_MASTER_KEY` auto-generated on first launch via `randomBytes(32)`
- Session `API_TOKEN` generated fresh per launch

### Secret Inventory

| Secret                             | Storage                               | Protection                                       |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `CREDENTIALS_MASTER_KEY`           | `.env` or `config.json`               | File permissions (`0o600`) only                  |
| Bank credentials                   | `credentials.enc`                     | AES-256-GCM (derived from master key via scrypt) |
| OAuth tokens                       | `oauth-credentials.json`              | File permissions (`0o600`) only                  |
| API keys (Anthropic, OpenAI, etc.) | `.env` or `config.json`               | File permissions only                            |
| `API_TOKEN`                        | env var (Electron: runtime-generated) | In-memory only in Electron                       |
| `TELEGRAM_BOT_TOKEN`               | `.env` or `config.json`               | File permissions only                            |

**Key finding:** Bank credentials are well-protected (AES-256-GCM), but the **master key itself** and all API tokens sit as plaintext on disk. The master key is the single point of failure.

---

## OS-Level Secret Storage Options

### 1. Electron `safeStorage` API (Recommended for Electron mode)

Built into Electron 15+, no extra dependency. This is what VS Code migrated to after `keytar` deprecation.

- **macOS:** Uses Keychain
- **Windows:** Uses DPAPI (Data Protection API)
- **Linux:** Uses `libsecret` (GNOME Keyring / KWallet)

`safeStorage.encryptString(secret)` returns an encrypted Buffer tied to the OS user session. Only the same OS user on the same machine can decrypt it.

### 2. `keytar` / `node-keytar` — DEPRECATED

Archived by GitHub in Dec 2022 (Atom sunset). No longer maintained. **Do not use.**

### 3. `@zowe/secrets-for-zowe-sdk`

Maintained keytar replacement for plain Node.js (not just Electron). Could work for standalone mode if a desktop environment is available. Adds native compilation dependency.

### 4. Headless Linux (no desktop)

OS keychains require a desktop session (D-Bus + GNOME Keyring/KWallet). Headless servers (Docker, VPS) don't have this. Alternatives:

- Accept master key only via environment variable (never write to disk)
- Use SOPS/age for encrypted `.env` files
- Use a secrets manager (HashiCorp Vault, etc.) — overkill for personal use

---

## Security Comparison

| Attack Vector                    | Current (plaintext file)          | OS Keychain                                             |
| -------------------------------- | --------------------------------- | ------------------------------------------------------- |
| Another user reads `.env`        | Blocked by file perms             | Blocked + encrypted                                     |
| Malware as your user reads files | **Vulnerable**                    | **Better** (macOS prompts, Windows DPAPI, Linux varies) |
| Disk stolen / cold boot          | **Vulnerable**                    | **Protected** (encrypted, tied to OS credentials)       |
| Backup exfiltration              | **Vulnerable** (plaintext in tar) | **Protected** (key stays in keychain)                   |
| Root/admin access                | Vulnerable                        | Also vulnerable                                         |
| Memory dump                      | Vulnerable                        | Also vulnerable                                         |

### Assessment

**Electron mode: Meaningful improvement.** Master key no longer plaintext on disk. Backup archives can't be used to decrypt `credentials.enc` without OS keychain access. macOS Keychain prompts for user auth.

**Standalone/server mode: Marginal benefit.** On headless Linux, no OS keychain exists. File-based encryption with `0o600` is already reasonable for self-hosted personal use.

**Biggest practical win:** Backups become safe by default. Currently `scripts/backup.sh` includes `.env` with the master key in plaintext.

---

## Recommendations

### Electron Mode (easy win, ~50 lines of code, zero new deps)

Use `safeStorage` to encrypt the master key and API keys before writing to `config.json`:

```typescript
// electron/main.ts
import { safeStorage } from 'electron';

// Encrypt before saving:
const encrypted = safeStorage.encryptString(masterKey);
saveToConfig({ CREDENTIALS_MASTER_KEY: encrypted.toString('base64') });

// Decrypt on load:
const decrypted = safeStorage.decryptString(Buffer.from(stored, 'base64'));
```

### Standalone Mode (minor improvements)

1. Accept master key only via environment variable (not `.env` file on disk)
2. Update `backup.sh` to exclude `.env` or warn about secrets
3. Document recommended practices for production deployments

### What NOT to do

- Don't add `keytar` or native modules for standalone — build complexity for minimal gain
- Don't over-engineer for a self-hosted personal app — AES-256-GCM for bank credentials is solid
