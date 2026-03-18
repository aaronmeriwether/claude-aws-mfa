export interface CliFlags {
  setup: boolean;
  cacheSession: boolean | undefined;  // undefined = use config default
  autoMfa: boolean | undefined;
  singleInstanceLock: boolean | undefined;
}

export function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    setup: false,
    cacheSession: undefined,
    autoMfa: undefined,
    singleInstanceLock: undefined,
  };
  for (const arg of argv.slice(2)) {
    switch (arg) {
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
    }
  }
  return flags;
}
