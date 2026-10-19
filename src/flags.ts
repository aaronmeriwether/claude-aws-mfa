export const HELP = `Usage: claude-aws-mfa [options]

With no options, prints temporary AWS credentials as JSON for Claude Code's
awsCredentialExport, prompting for MFA when needed.

Options:
  --setup                     Launch the guided setup wizard
  --[no-]cache-session        Reuse cached STS credentials until they expire (default: on)
  --[no-]auto-mfa             Run the configured MFA command without showing the dialog (default: on)
  --[no-]single-instance-lock Let only one instance show a dialog at a time (default: on)
  --no-ui                     Never show a GUI; errors go to stderr
  --usage[=[<role>/]<session>]
                              Print Bedrock token usage and estimated cost instead of
                              credentials, for a session name (default: the one in the
                              config), optionally under one role. Use * to itemize:
                                --usage=my-role/*   one row per session of role my-role
                                --usage=*           one row per role
  --profile=<name>            With --usage: query using this AWS profile instead of the
                              tool's own credentials
  --from=<date>               With --usage: start of range (default: start of this month)
  --to=<date>                 With --usage: end of range, exclusive (default: now)
  -h, --help                  Show this help`;

export interface CliFlags {
  help: boolean;
  setup: boolean;
  cacheSession: boolean | undefined;  // undefined = use config default
  autoMfa: boolean | undefined;
  singleInstanceLock: boolean | undefined;
  noUi: boolean;
  usage: boolean;
  usageSpec?: string;  // --usage=[<role>/]<session>; undefined = session name from config
  profile?: string;
  from?: string;
  to?: string;
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    help: false,
    setup: false,
    cacheSession: undefined,
    autoMfa: undefined,
    singleInstanceLock: undefined,
    noUi: false,
    usage: false,
  };
  for (const arg of argv.slice(2)) {
    const [key, value] = arg.split(/=(.*)/s);
    if (value !== undefined && (key === "--profile" || key === "--from" || key === "--to")) {
      flags[key.slice(2) as "profile" | "from" | "to"] = value;
      continue;
    }
    if (key === "--usage" && value !== undefined) {
      flags.usage = true;
      flags.usageSpec = value || undefined;
      continue;
    }
    switch (arg) {
      case "-h":
      case "--help":
        flags.help = true;
        break;
      case "setup":
      case "--setup":
        flags.setup = true;
        break;
      case "--cache-session":
        flags.cacheSession = true;
        break;
      case "--no-cache-session":
        flags.cacheSession = false;
        break;
      case "--auto-mfa":
        flags.autoMfa = true;
        break;
      case "--no-auto-mfa":
        flags.autoMfa = false;
        break;
      case "--single-instance-lock":
        flags.singleInstanceLock = true;
        break;
      case "--no-single-instance-lock":
        flags.singleInstanceLock = false;
        break;
      case "--no-ui":
        flags.noUi = true;
        break;
      case "--usage":
        flags.usage = true;
        break;
    }
  }
  return flags;
}
