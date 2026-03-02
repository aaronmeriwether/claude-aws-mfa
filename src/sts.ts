import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

export const STANDARD_DURATIONS = [129600, 86400, 43200, 28800, 21600, 14400, 7200, 3600];

export function isDurationError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("durationseconds") || (msg.includes("duration") && msg.includes("exceed"));
}

// Builds a descending list of durations to try: the user's value first (if non-standard),
// then all standard values <= the user's value.
export function durationLadder(userDuration: number): number[] {
  const ladder = STANDARD_DURATIONS.includes(userDuration) ? [] : [userDuration];
  for (const d of STANDARD_DURATIONS) {
    if (d <= userDuration) ladder.push(d);
  }
  return ladder.length ? ladder : [userDuration];
}

export async function assumeRoleWithMfa(params: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  mfaArn: string;
  roleArn: string;
  mfaCode: string;
  duration: number;
}) {
  const client = new STSClient({
    region: params.region,
    credentials: { accessKeyId: params.accessKeyId, secretAccessKey: params.secretAccessKey },
  });

  const ladder = durationLadder(params.duration);

  for (let i = 0; i < ladder.length; i++) {
    try {
      const { Credentials: c } = await client.send(new AssumeRoleCommand({
        RoleArn: params.roleArn,
        RoleSessionName: "claude-aws-mfa",
        SerialNumber: params.mfaArn,
        TokenCode: params.mfaCode,
        DurationSeconds: ladder[i],
      }));
      return {
        credentials: {
          AccessKeyId: c!.AccessKeyId!,
          SecretAccessKey: c!.SecretAccessKey!,
          SessionToken: c!.SessionToken!,
        },
        duration: ladder[i],
      };
    } catch (err) {
      if (i === ladder.length - 1 || !isDurationError(err)) throw err;
    }
  }
  throw new Error("All duration attempts failed");
}
