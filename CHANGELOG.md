# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

### Releasing

Releases are automated via CI. To create a new release:

1. Add a new entry at the top of this file with heading `## [vX.Y.Z]` (without a
   date). This is a draft — it can be merged to `main` without triggering a
   release.
2. When ready to publish, update the heading to `## [vX.Y.Z] - YYYY-MM-DD` and
   merge to `main`. The date signals "ready to release".
3. The workflow will run tests, create a Git tag, GitHub Release, and npm publish.
4. If the tag already exists, the workflow skips (safe to re-merge).
5. If tests fail, no tag/release is created. The release will be re-attempted on
   each subsequent push to `main`, or can be manually retried from the Actions UI.

Stable versions (e.g. `v1.2.0`) publish to npm `@latest`. Pre-release versions
(e.g. `v1.2.0-rc.1`) publish to npm `@next` and create a GitHub pre-release.

## [v1.1.0-rc.2] - Unreleased

### Changed
- Automated release pipeline: releases are now triggered by changelog entries pushed to `main`, replacing the previous manual GitHub Release workflow.

### Fixed
- Release workflow: use `RELEASE_PAT` via `actions/checkout` token so git credential helper authenticates with the PAT instead of the default `GITHUB_TOKEN` (which cannot bypass tag rulesets).

### Added
- CHANGELOG.md to track project changes.
- Updated README with documentation for new CLI flags and features.

## [v1.1.0-rc.1] - 2026-03-29

### Added
- **Session caching** (`--cache-session`): Cache STS session credentials in the config file and reuse them until they expire, avoiding repeated MFA prompts.
- **Auto-MFA** (`--auto-mfa`): Automatically run the configured MFA command to obtain credentials without showing the dialog. Falls back to the dialog if the command fails.
- **Single-instance lock** (`--single-instance-lock`): Prevent multiple concurrent instances from showing overlapping dialogs. Subsequent invocations wait for the first to finish and reuse its cached session.
- New CLI flags with `--no-` negation support for all new options.
- New config file options: `cacheSession`, `autoMfa`, `singleInstanceLock`.
- Tests for session caching, lock mechanism, and CLI flag parsing.

## [v1.0.0] - 2026-03-28

### Added
- Initial stable release.
- Native GUI dialog for AWS credential and MFA code entry.
- MFA Command mode: provide a shell command (e.g. `op item get --otp …`) to fetch TOTP codes automatically.
- Automatic STS session duration negotiation (12h → 6h → 2h → 1h).
- Guided setup wizard (`--setup`) for Claude Code Bedrock configuration.
- Configuration persistence in `~/.config/claude-aws-mfa.json` (mode 0600).
- Credential masking in error output.
- Cross-platform support (macOS, Linux, Windows).
- CI test workflows (unit + GUI screenshot tests).
- npm publish workflow triggered by GitHub Releases.
