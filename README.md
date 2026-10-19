# claude-aws-mfa

AWS MFA credential helper for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Shows a native dialog to collect AWS credentials and an MFA code, calls STS AssumeRole with automatic duration negotiation, and outputs temporary credentials to stdout in the format Claude Code expects.

## Install

Requires [Bun](https://bun.sh) runtime.

```bash
bun install -g claude-aws-mfa@latest
```

## Configure Claude Code

### Guided Setup

Run `claude-aws-mfa --setup`, to access a configuration UI for easy setup of this tool.  You will be presented with a checkbox to enable Bedrock via claude-aws-mfa, and fields to customize a few key settings.   Specifically, you can pin specific versions of the Anthropic models to use for Opus, Sonnet, and Haiku, in case your Bedrock policy does not allow you access to the latest default models that Claude Code will try to use.

Once you have enabled credential-handling and saved the settings, you can launch Claude Code and begin work.  You will automatically prompted for your AWS credentials, and Claude will connect to the specified AWS Bedrock account rather than to the Anthropic servers.

### Manual Setup

Add this (plus any addtitional config you prefer) to your Claude Code settings (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` if you use per-project profiles):

```json
{
  "awsCredentialExport": "claude-aws-mfa",
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_SHARED_CREDENTIALS_FILE": "/dev/null"
  }
}
```

## CLI Flags

`--cache-session`, `--auto-mfa`, and `--single-instance-lock` are all **on by default**; use the `--no-` prefix to disable one (e.g. `--no-cache-session`). CLI flags override values saved in the config file.

| Flag | Description |
|------|-------------|
| `--setup` | Launch the guided setup wizard |
| `-h`, `--help` | Show usage help |
| `--cache-session` | Cache STS session credentials and reuse them until they expire (default: on) |
| `--auto-mfa` | Automatically run the configured MFA command and obtain credentials without showing the dialog, requires MFA Command mode (default: on) |
| `--single-instance-lock` | Prevent multiple concurrent instances from showing overlapping dialogs; subsequent invocations wait for the first to finish and reuse its cached session (default: on) |
| `--usage[=[<role>/]<session>]` | Print Bedrock token usage for a session name (default: the one in the config), optionally under one role; `*` itemizes instead of credentials (see [Usage report](#usage-report)) |
| `--profile=<name>` | With `--usage`: query using this AWS profile instead of the tool's own credentials |
| `--from=<date>` / `--to=<date>` | With `--usage`: time range (default: start of the current month to now; `--to` is exclusive) |
| `--no-ui` | Never show any GUI dialog. Prints credentials JSON to stdout on success, or an error to stderr on failure — useful for scripting or letting an LLM drive the tool during setup/debugging |

## How it works

1. On first run, seeds the dialog with credentials from your existing AWS config (`~/.aws/credentials`, environment variables, SSO, etc.)
2. Shows a native GUI dialog with fields for region, access key, secret key, MFA ARN, role ARN, session duration, and STS session name (defaults to `claude-aws-mfa`)
3. Collects the MFA token — either type a 6-digit code directly, or switch to **MFA Command** mode and provide a shell command that outputs the code (e.g. `op item get --otp …` for 1Password CLI)
4. Calls `sts:AssumeRole` with the MFA token
5. If the requested session duration is rejected, automatically retries with shorter durations (12h → 6h → 2h → 1h)
6. Saves configuration (including MFA mode and command) to `~/.config/claude-aws-mfa.json` (mode 0600) for subsequent runs
7. Outputs temporary credentials as JSON to stdout

If `AWS_REGION` is set, it overrides the configured region for all AWS calls (STS and `--usage`); the saved config is left unchanged. When Claude Code runs the tool, it sees whatever `AWS_REGION` Claude Code's environment has (including one set in `settings.json`); when you run it yourself from a shell, it only sees your shell's.

On subsequent runs, all fields are pre-populated from the saved config — just enter a fresh MFA code and hit OK. If you use the command mode, the TOTP code is fetched automatically so no manual entry is needed at all.

### Claude Code profiles

Claude Code reads its settings from `$CLAUDE_CONFIG_DIR` when that is set, which tools such as [claude-as](https://github.com/aaronmeriwether/claude-as) use to give each project its own credentials. This tool follows suit:

- `--setup` reads and writes `$CLAUDE_CONFIG_DIR/settings.json`, so a profile can be Bedrock-only while others stay on OAuth.
- The config file is scoped per profile — `~/.config/claude-aws-mfa<profile>.json`, where `<profile>` is the config dir path encoded the way Claude encodes project dirs (`/` and `.` both become `-`). Different profiles usually mean different AWS accounts, and a shared cached session would hand a profile credentials for the wrong one.
- The default `~/.claude` gets no suffix, so existing installs keep using `~/.config/claude-aws-mfa.json` unchanged.
- Because the lock is per profile too, two profiles can have a dialog open at once. Every dialog names its profile — in the window title and in a banner under the heading — so you can tell which AWS account a prompt is asking for. The default config dir is named `default` rather than left unlabelled, so a blank banner never has to be interpreted.

Child processes inherit `CLAUDE_CONFIG_DIR`, so credential export picks up the right profile automatically. `--setup` run from an ordinary shell does not — it configures whatever profile the shell is in, normally the default. To set up a specific profile, export the variable first:

```bash
CLAUDE_CONFIG_DIR=~/.claude-profiles/work claude-aws-mfa --setup
```

### Session caching

With `--cache-session` (or `"cacheSession": true` in the config file), temporary credentials are saved to the config file and reused on subsequent runs until they expire. This avoids prompting for MFA on every invocation.

### Auto-MFA

With `--auto-mfa` (or `"autoMfa": true` in the config file), when a MFA command is configured, credentials are obtained automatically without showing the dialog at all. If the command fails or isn't configured, the dialog is shown as a fallback.

### Single-instance lock

With `--single-instance-lock` (or `"singleInstanceLock": true` in the config file), only one instance of the tool will show a dialog at a time. Additional invocations will wait for the first to finish and then reuse its cached session (when session caching is also enabled). The lock file is stored alongside the config file (`~/.config/claude-aws-mfa.lock`, per profile) and is automatically cleaned up after 2 minutes if the holding process crashes.

### Authentication failures

Claude Code does not surface a failing command's stderr to the user, so when MFA/STS authentication fails, the error is shown in a native dialog box instead of being written to stderr.

### `--no-ui` mode

With `--no-ui`, no GUI is ever shown — not even the error dialog above — and the tool never imports the GUI toolkit, so it also works in headless environments without a display. On success, credentials are printed to stdout as usual, keeping stdout cleanly parsable. On failure, an error message is printed to **stderr** instead (e.g. `Missing config: roleArn, mfaCommand` if the config is incomplete, or the underlying STS error if authentication itself failed) and the process exits non-zero. This is intended for scripting and for letting an LLM drive the tool directly while setting up or debugging a configuration — full non-interactive operation requires **MFA Command mode**, since a static "code" mode value can't be re-entered headlessly. The command doesn't need to be a real TOTP generator: for a one-off test or debugging run, `mfaCommand` can simply be `echo <code>` with a fresh, not-yet-used code from your authenticator — it only needs to produce a valid code once.

### Usage report

`claude-aws-mfa --usage` prints per-model request and token counts (input, cache read/write, output), with an estimated cost, for every Bedrock call made under the configured STS session name.

`--usage=` takes `[<role>/]<session>` to choose whose usage to report. Either part can be `*`, which gives one row per role or session (all models merged) instead of one row per model:

| Value | Reports |
|-------|---------|
| *(none)* | The session name from the config, any role, per model |
| `claude-aws-mfa` | That session name under any role, per model |
| `my-role/claude-aws-mfa` | That session of role `my-role`, per model |
| `my-role/*` | Each session of role `my-role` |
| `*` | Each role (its sessions merged) |
| `*/*` | Each role and session pair |

```bash
claude-aws-mfa --usage                                   # this month, using the tool's own role session
claude-aws-mfa --usage --from=2026-09-01 --to=2026-10-01 # September
claude-aws-mfa --usage --profile=billing                 # query with a different AWS profile
claude-aws-mfa --usage='my-role/*'                         # quote * so the shell doesn't expand it
```

Only callers that assumed a role are counted; calls made directly with IAM user keys never match.

Only one region is queried: `AWS_REGION` if set, otherwise the configured region. If your Claude Code `settings.json` sets `AWS_REGION` to something other than the configured region, pass the same value when running `--usage` from a shell (`AWS_REGION=eu-west-1 claude-aws-mfa --usage`) to report on the region Claude Code uses. Cross-region inference calls (`us.`/`global.` profiles) are logged in the region they were made from, so they are included. The data comes from Bedrock [model invocation logs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html), so invocation logging to CloudWatch Logs must be enabled in the account and region. The querying credentials need `bedrock:GetModelInvocationLoggingConfiguration`, `logs:StartQuery` and `logs:GetQueryResults`. Without `--profile`, credentials are obtained exactly as for Claude Code (cached session, auto-MFA, or the dialog). Errors go to stderr.

Costs are estimated from AWS's public [Price List](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html) for the region (no extra permissions needed), at current base on-demand rates — `us.`/`eu.` cross-region profiles at their geo price, `global.` at the global price. They exclude negotiated discounts and the long-context and 1-hour-cache-write surcharges, which the aggregated logs can't distinguish, so treat them as an estimate rather than your bill. If prices can't be fetched, token counts are still printed.

## System requirements

The GUI dialog uses [webview-bun](https://github.com/tr1ckydev/webview-bun), which requires:

- **macOS**: No additional dependencies (uses WebKit)
- **Linux**: `sudo apt install libwebkitgtk-6.0-4` (Debian/Ubuntu)
- **Windows**: Edge WebView2 runtime (included in Windows 11+)

## Development

```bash
bun install
bun run src/index.ts       # run locally
bun test                   # run tests
```

## Releasing

See the [Releasing section of CHANGELOG.md](CHANGELOG.md#releasing) for how to publish new versions.

## License

MIT
