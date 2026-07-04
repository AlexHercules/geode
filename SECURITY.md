# Security Policy

Geode is a local-first desktop application that reads and writes user-selected folders. Security reports are welcome.

## Supported versions

Geode is currently in active alpha. Security fixes are handled on the default branch first.

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:

<https://github.com/AlexHercules/geode/security/advisories/new>

Do not open a public issue for vulnerabilities involving file access, path traversal, plugin execution, updater behavior, or secret exposure.

Helpful details include:

- Operating system
- Geode commit or version
- Reproduction steps
- Whether the issue requires a malicious vault, a malicious plugin, or only normal user interaction
- Any relevant logs or screenshots

## Areas of special concern

- Vault path traversal
- File deletion, rename, and external modification races
- Plugin loading and compatibility shims
- Tauri command boundaries
- Updater signing and release artifacts
- Accidental inclusion of private vault data or signing keys
