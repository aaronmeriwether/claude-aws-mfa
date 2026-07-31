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

## [v1.2.0]

### Added
- **`--no-ui` mode**: skip the GUI entirely and drive the tool from the command line — useful for scripting and for letting an LLM operate the tool during setup/debugging. Prints credentials JSON to stdout on success, keeping stdout cleanly parsable; on failure, prints the underlying error (or names the specific missing config field(s) when the config is incomplete) to stderr. Never imports the GUI toolkit, so it also works in headless environments.
- **Error dialog**: authentication failures (STS or MFA command) now show a native dialog box instead of writing to stderr, since Claude Code doesn't surface a failing command's stderr to the user. Suppressed in `--no-ui` mode, where the error is printed to stderr instead.

### Changed
- **Dialogs size themselves to their content.** Every window (main dialog, setup, error) opens small and grows to exactly fit what it renders, instead of using a hardcoded height that had to be guessed and re-guessed whenever the layout changed. Content taller than the cap scrolls rather than being clipped — long error messages are now fully readable. Measured on Linux/WebKitGTK: the main dialog settles at 610px (was hardcoded to 670) and setup at 419px (was 480).
- `--cache-session`, `--auto-mfa`, and `--single-instance-lock` are now **enabled by default**; use `--no-cache-session`, `--no-auto-mfa`, or `--no-single-instance-lock` to opt out.
- `--setup` no longer hardcodes an absolute script path into `awsCredentialExport` when the tool is installed and resolvable via `PATH` — it records just the bin name so the setting keeps working across reinstalls/machines. An explicit absolute path is only written as a fallback when running against a local checkout that isn't on `PATH`.

### Fixed
- **Release workflow no longer fails on every push after a release.** The changelog entry for a shipped version stays at the top of the file, so each later push to `main` re-parsed it — and because the entry was validated *before* the already-released check, it was rejected as a malformed new release (`Changelog date … does not match today`). The already-released check now runs first, and asks the remote for the tag rather than trusting whatever tags `checkout` happened to fetch.
- A dated-but-unreleased entry is no longer rejected for having a past date, so the documented "re-attempted on each subsequent push to `main`" retry after a failed release actually works. A date in the *future* is still an error, since the workflow has no way to defer a release.

## [v1.1.0] - 2026-06-04

### Added
- **Session caching** (`--cache-session`): Cache STS session credentials in the config file and reuse them until they expire, avoiding repeated MFA prompts.
- **Auto-MFA** (`--auto-mfa`): Automatically run the configured MFA command to obtain credentials without showing the dialog. Falls back to the dialog if the command fails.
- **Single-instance lock** (`--single-instance-lock`): Prevent multiple concurrent instances from showing overlapping dialogs. Subsequent invocations wait for the first to finish and reuse its cached session.
- New CLI flags with `--no-` negation support for all new options.
- New config file options: `cacheSession`, `autoMfa`, `singleInstanceLock`.
- Tests for session caching, lock mechanism, and CLI flag parsing.
- CHANGELOG.md to track project changes.
- Updated README with documentation for new CLI flags and features.

### Changed
- Automated release pipeline: releases are now triggered by changelog entries pushed to `main`, replacing the previous manual GitHub Release workflow.

### Fixed
- Release workflow: use `RELEASE_PAT` via `actions/checkout` token so git credential helper authenticates with the PAT instead of the default `GITHUB_TOKEN` (which cannot bypass tag rulesets).

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
