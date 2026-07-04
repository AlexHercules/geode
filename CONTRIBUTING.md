# Contributing to Geode

Thanks for taking the time to improve Geode.

Geode is still in active alpha, so the best contributions are focused, well-scoped changes that preserve the local-first markdown contract.

## Good first contribution areas

- Documentation fixes
- Reproducible bug reports
- Small UI fidelity improvements
- Focused Obsidian compatibility fixes
- Tests for existing behavior
- Performance probes that make regressions easier to catch

## Before you start

Please read:

- [README.md](README.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/OBSIDIAN-COMPAT.md](docs/OBSIDIAN-COMPAT.md), if your change touches plugin compatibility

## Local setup

```sh
npm install
npm run dev
```

For desktop development:

```sh
npm run tauri dev
```

## Required checks

Before submitting a PR, run at least:

```sh
npm run typecheck
npm run build
```

If you touch a feature with an existing calibration script, run that script too. For example:

```sh
node .calibration/r78-e2e.mjs
```

## Architecture rules

- `src/core` must stay framework-free and must not import feature or app code.
- Feature modules should not import other feature modules.
- `src/compat` is isolated compatibility code and must not be imported by first-party features.
- User notes are plain markdown files. Be extremely conservative around file writes, rename propagation, editor transactions, and vault IO.
- Add or preserve `data-testid` attributes for UI that needs E2E coverage.

## Legal and compatibility boundaries

- Do not copy proprietary Obsidian source code or assets.
- Do not commit private vault contents.
- Do not commit updater signing keys or local secrets.
- Do not vendor community plugin bundles into the repository unless their license and inclusion have been explicitly reviewed.
- Keep compatibility work based on public APIs, observable behavior, or original tests.

## Commit style

The existing history often uses:

```text
feat(r276): short description
docs(r276): short description
```

For general contributions, a conventional prefix such as `fix:`, `feat:`, `docs:`, or `test:` is fine.

