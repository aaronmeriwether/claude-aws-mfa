import { BedrockClient, GetModelInvocationLoggingConfigurationCommand } from "@aws-sdk/client-bedrock";
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DEFAULT_SESSION_NAME } from "./sts";

const COLUMNS = ["requests", "inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"] as const;
const HEADERS = ["Model", "Requests", "Input", "Cache read", "Cache write", "Output"];

/** Start of the current month (local time) through now, unless overridden. */
export function usageRange(from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(to) : now;
  if (isNaN(start.getTime())) throw new Error(`Invalid --from date: ${from}`);
  if (isNaN(end.getTime())) throw new Error(`Invalid --to date: ${to}`);
  if (start >= end) throw new Error("--from must be before --to");
  return { start, end };
}

type GroupField = "roleName" | "sessionName";
const GROUP_HEADERS: Record<GroupField, string> = { roleName: "Role", sessionName: "Session" };

/** What `--usage=<spec>` selects; an undefined role/session matches any. */
export interface UsageSpec {
  role?: string;
  session?: string;
  groupBy: GroupField[];
}

/**
 * `--usage=[<role>/]<session>`. Either part may be `*`, meaning "itemize by
 * it": `my-role/*` gives one row per session of role my-role. A bare `*` itemizes
 * by role (sessions merged); a bare name matches that session under any role.
 */
export function parseUsageSpec(spec: string): UsageSpec {
  if (spec === "*") return { groupBy: ["roleName"] };
  const parts = spec.split("/");
  if (parts.length > 2) throw new Error(`Invalid --usage value "${spec}": expected [<role>/]<session-name>`);
  const [role, session] = parts.length === 2 ? parts : [undefined, parts[0]];
  // IAM's charset for role and session names; also keeps them safe to embed as query literals.
  for (const name of [role, session]) {
    if (name !== undefined && name !== "*" && !/^[\w+=,.@-]+$/.test(name)) {
      throw new Error(`Invalid role or session name "${name}" in --usage value "${spec}"`);
    }
  }
  return {
    role: role === "*" ? undefined : role,
    session: session === "*" ? undefined : session,
    groupBy: [role === "*" && "roleName", session === "*" && "sessionName"].filter((g): g is GroupField => !!g),
  };
}

/**
 * Logs Insights query summing token counts per model (and per group) for the
 * assumed-role callers a spec selects. The caller's ARN is
 * `arn:aws:sts::<acct>:assumed-role/<role>/<session>`; other callers (IAM
 * users, root) never match.
 */
export function usageQuery(spec: UsageSpec): string {
  const filters = ["ispresent(sessionName)"];
  if (spec.role) filters.push(`roleName = "${spec.role}"`);
  if (spec.session) filters.push(`sessionName = "${spec.session}"`);
  return [
    "parse identity.arn /:assumed-role\\/(?<roleName>[^\\/]+)\\/(?<sessionName>[^\\/]+)$/",
    `| filter ${filters.join(" and ")}`,
    "| stats count(*) as requests, sum(input.inputTokenCount) as inputTokens,",
    "  sum(input.cacheReadInputTokenCount) as cacheReadTokens, sum(input.cacheWriteInputTokenCount) as cacheWriteTokens,",
    `  sum(output.outputTokenCount) as outputTokens by ${[...spec.groupBy, "modelId"].join(", ")}`,
  ].join("\n");
}

type Column = (typeof COLUMNS)[number];
/** Per-token USD prices, keyed by `<Price List model name>|<global?>`. */
export type PriceTable = Record<string, Partial<Record<Column, number>>>;

const PRICED_COLUMNS: Record<string, Column> = {
  "Input tokens": "inputTokens",
  "Output tokens": "outputTokens",
  "Prompt cache read input tokens": "cacheReadTokens",
  "Prompt cache write input tokens": "cacheWriteTokens",
};

/**
 * Standard on-demand token prices from an AWS Price List offer file
 * (AmazonBedrockFoundationModels). Long-context, 1h-cache-write and
 * latency-optimized variants are skipped: the aggregated logs can't tell those
 * requests apart, so every token is priced at the base rate.
 */
export function parsePriceList(offer: any): PriceTable {
  const table: PriceTable = {};
  for (const [sku, product] of Object.entries<any>(offer.products ?? {})) {
    const a = product.attributes ?? {};
    const column = PRICED_COLUMNS[a.inferenceType];
    if (a.feature !== "On-demand Inference" || !column || /long_ctx|1h|LatencyOptimized/i.test(a.usagetype)) continue;
    const dim: any = Object.values<any>(Object.values<any>(offer.terms?.OnDemand?.[sku] ?? {})[0]?.priceDimensions ?? {})[0];
    if (dim?.unit !== "1M tokens") continue;
    (table[`${a.model}|${/global/i.test(a.usagetype)}`] ??= {})[column] = Number(dim.pricePerUnit.USD) / 1e6;
  }
  return table;
}

/** `…/us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Claude Sonnet 4.5`, the Price List's model name. */
export function priceListModelName(modelId: string): string {
  const words = modelId.split("/").pop()!.split(".").pop()!.replace(/-\d{8}.*$|-v\d+(:\d+)?$/, "").split("-");
  return words
    .map((w, i) => (i === 0 ? "" : /^\d+$/.test(w) && /^\d+$/.test(words[i - 1]) ? "." : " ") + w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** USD cost of one row, or undefined if any token type it used has no known price. */
export function rowCost(row: Record<string, string>, prices: PriceTable): number | undefined {
  const isGlobal = row.modelId.split("/").pop()!.startsWith("global.");
  const price = prices[`${priceListModelName(row.modelId)}|${isGlobal}`] ?? {};
  let cost = 0;
  for (const c of COLUMNS.slice(1)) {
    const tokens = Number(row[c] || 0);
    if (!tokens) continue;
    if (price[c] === undefined) return undefined;
    cost += tokens * price[c]!;
  }
  return cost;
}

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Tally {
  label: string;
  counts: number[];
  cost: number;
  unpriced: boolean; // some tokens had no list price, so `cost` is a lower bound
}

function tally(label: string, rows: Record<string, string>[], prices: PriceTable): Tally {
  const t: Tally = { label, counts: COLUMNS.map(() => 0), cost: 0, unpriced: false };
  for (const r of rows) {
    COLUMNS.forEach((c, i) => (t.counts[i] += Number(r[c] || 0)));
    const cost = rowCost(r, prices);
    if (cost === undefined) t.unpriced = true;
    else t.cost += cost;
  }
  return t;
}

/** One line per model, or per group (role and/or session, models merged) when itemizing. */
export function formatUsageTable(rows: Record<string, string>[], prices: PriceTable = {}, groupBy: GroupField[] = []): string {
  if (!rows.length) return "No Bedrock invocations found.";
  const labelOf = (r: Record<string, string>) =>
    groupBy.length ? groupBy.map((g) => r[g]).join("/") : (r.modelId ?? "").split("/").pop()!;
  const groups = Map.groupBy(rows, labelOf);
  const tallies = [...groups].map(([label, rs]) => tally(label, rs, prices)).sort((a, b) => b.cost - a.cost);
  const total = tally("TOTAL", rows, prices);

  const cost = (t: Tally) => (t.unpriced && !t.cost ? "?" : usd(t.cost) + (t.unpriced ? "+" : ""));
  const cells = (t: Tally) => [t.label, ...t.counts.map((n) => n.toLocaleString("en-US")), cost(t)];
  const headers = [groupBy.length ? groupBy.map((g) => GROUP_HEADERS[g]).join("/") : "Model", ...HEADERS.slice(1), "Cost (USD)"];
  const table = [...tallies, total].map(cells);
  const widths = headers.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const line = (cs: string[]) => cs.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ");
  return [
    line(headers),
    ...table.slice(0, -1).map(line),
    widths.map((w) => "-".repeat(w)).join("  "),
    line(table.at(-1)!),
    "",
    "Cost is an estimate at current AWS list prices (base on-demand rates; excludes discounts, long-context and 1h-cache surcharges).",
    ...(total.unpriced ? ["? / + = some models have no list price and are excluded from the cost."] : []),
  ].join("\n");
}

/** Bedrock prices for `region` from the public AWS Price List bulk API (no credentials needed). */
async function fetchPrices(region: string): Promise<PriceTable> {
  const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/${region}/index.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return parsePriceList(await res.json());
}

/**
 * Query Bedrock model invocation logs (CloudWatch Logs destination) for usage
 * by the role/session that `spec` (see parseUsageSpec) selects. Requires invocation logging to be enabled.
 * `credentials` undefined + `profile` set → the SDK resolves that profile.
 */
export async function printUsage(opts: {
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  profile?: string;
  spec?: string;
  from?: string;
  to?: string;
}): Promise<void> {
  const { start, end } = usageRange(opts.from, opts.to);
  const specText = opts.spec || DEFAULT_SESSION_NAME;
  const spec = parseUsageSpec(specText);
  const clientConfig = { region: opts.region || undefined, credentials: opts.credentials, profile: opts.profile };

  const bedrock = new BedrockClient(clientConfig);
  // Prices are best-effort: token counts are still worth printing without them.
  const prices = bedrock.config.region().then(fetchPrices).catch((err) => {
    process.stderr.write(`Could not fetch Bedrock prices, costs omitted: ${err instanceof Error ? err.message : err}\n`);
    return {};
  });

  const { loggingConfig } = await bedrock.send(new GetModelInvocationLoggingConfigurationCommand({}));
  const logGroupName = loggingConfig?.cloudWatchConfig?.logGroupName;
  if (!logGroupName) {
    throw new Error("Bedrock model invocation logging to CloudWatch Logs is not enabled in this account/region, so there is no per-session usage to query.");
  }

  const logs = new CloudWatchLogsClient(clientConfig);
  const { queryId } = await logs.send(new StartQueryCommand({
    logGroupName,
    startTime: Math.floor(start.getTime() / 1000),
    endTime: Math.floor(end.getTime() / 1000),
    queryString: usageQuery(spec),
  }));

  let res;
  do {
    await Bun.sleep(1000);
    res = await logs.send(new GetQueryResultsCommand({ queryId }));
  } while (res.status === "Scheduled" || res.status === "Running");
  if (res.status !== "Complete") throw new Error(`Logs Insights query ${res.status}`);

  const rows = (res.results ?? []).map((r) => Object.fromEntries(r.map((f) => [f.field!, f.value ?? ""])));
  console.log(`Bedrock usage for ${specText}, ${start.toISOString()} – ${end.toISOString()} (log group ${logGroupName})\n`);
  console.log(formatUsageTable(rows, await prices, spec.groupBy));
}
