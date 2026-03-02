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

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "awsCredentialExport": "claude-aws-mfa"
}
```

If you have an existing `~/.aws/credentials` file, you will likely need to suppress Claude's use of that file so it will correctly invoke the `awsCredentialExport` tool instead.

```json
{
  "env": {
    "AWS_SHARED_CREDENTIALS_FILE": "/dev/null"
  }
}
```

## How it works

1. On first run, seeds the dialog with credentials from your existing AWS config (`~/.aws/credentials`, environment variables, SSO, etc.)
2. Shows a native GUI dialog with fields for region, access key, secret key, MFA ARN, role ARN, and session duration
3. Collects the MFA token — either type a 6-digit code directly, or switch to **MFA Command** mode and provide a shell command that outputs the code (e.g. `op item get --otp …` for 1Password CLI)
4. Calls `sts:AssumeRole` with the MFA token
5. If the requested session duration is rejected, automatically retries with shorter durations (12h → 6h → 2h → 1h)
6. Saves configuration (including MFA mode and command) to `~/.config/claude-aws-mfa.json` (mode 0600) for subsequent runs
7. Outputs temporary credentials as JSON to stdout

On subsequent runs, all fields are pre-populated from the saved config — just enter a fresh MFA code and hit OK. If you use the command mode, the TOTP code is fetched automatically so no manual entry is needed at all.

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

## License

MIT
