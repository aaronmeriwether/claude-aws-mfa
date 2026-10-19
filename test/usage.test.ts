import { describe, test, expect } from "bun:test";
import { parseUsageSpec, usageQuery, usageRange, formatUsageTable, parsePriceList, priceListModelName, rowCost } from "../src/usage";
import { parseFlags } from "../src/flags";

describe("usage", () => {
  test("parses --usage, --profile=, --from=, --to=", () => {
    const f = parseFlags(["bun", "x", "--usage", "--profile=work", "--from=2026-09-01", "--to=2026-10-01"]);
    expect(f).toMatchObject({ usage: true, profile: "work", from: "2026-09-01", to: "2026-10-01" });
  });

  test("parses --usage=<spec>", () => {
    expect(parseFlags(["bun", "x", "--usage=my-role/*"])).toMatchObject({ usage: true, usageSpec: "my-role/*" });
    expect(parseFlags(["bun", "x", "--usage"]).usageSpec).toBeUndefined();
  });

  test("parses usage specs", () => {
    expect(parseUsageSpec("sess")).toEqual({ role: undefined, session: "sess", groupBy: [] });
    expect(parseUsageSpec("my-role/sess")).toEqual({ role: "my-role", session: "sess", groupBy: [] });
    expect(parseUsageSpec("my-role/*")).toEqual({ role: "my-role", session: undefined, groupBy: ["sessionName"] });
    expect(parseUsageSpec("*")).toEqual({ groupBy: ["roleName"] });
    expect(parseUsageSpec("*/*")).toEqual({ role: undefined, session: undefined, groupBy: ["roleName", "sessionName"] });
    expect(parseUsageSpec("jane.doe@example.com").session).toBe("jane.doe@example.com");
    expect(() => parseUsageSpec("a/b/c")).toThrow("expected");
    expect(() => parseUsageSpec('x" or 1=1')).toThrow("Invalid role or session");
    expect(() => parseUsageSpec("my-role/")).toThrow("Invalid role or session");
  });

  test("defaults to the current month", () => {
    const { start, end } = usageRange();
    const now = new Date();
    expect(start).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
    expect(end.getTime()).toBeGreaterThanOrEqual(start.getTime());
  });

  test("rejects bad ranges", () => {
    expect(() => usageRange("nope")).toThrow("Invalid --from");
    expect(() => usageRange("2026-10-02", "2026-10-01")).toThrow("before");
  });

  test("query parses role and session from the caller ARN and filters/groups by the spec", () => {
    const q = usageQuery(parseUsageSpec("my-role/*"));
    expect(q).toContain('filter ispresent(sessionName) and roleName = "my-role"\n');
    expect(q).toContain("by sessionName, modelId");
    const re = new RegExp(q.match(/^parse identity\.arn \/(.*)\/$/m)![1]);
    expect("arn:aws:sts::1:assumed-role/my-role/jane.doe@example.com".match(re)?.groups).toEqual({ roleName: "my-role", sessionName: "jane.doe@example.com" });
    expect(re.test("arn:aws:iam::1:user/bob")).toBe(false);
    expect(usageQuery(parseUsageSpec("sess"))).toContain('and sessionName = "sess"\n');
    expect(usageQuery(parseUsageSpec("sess"))).toContain("by modelId");
  });

  test("formats a table with totals", () => {
    const out = formatUsageTable([
      { modelId: "m1", requests: "2", inputTokens: "1000", outputTokens: "50" },
      { modelId: "m2", requests: "1", inputTokens: "10", cacheReadTokens: "5", outputTokens: "1" },
    ]);
    expect(out).toContain("TOTAL");
    expect(out.split("\n").find((l) => l.startsWith("TOTAL"))).toMatch(/^TOTAL\s+3\s+1,010\s+5\s+0\s+51\s+\?$/);
    expect(formatUsageTable([])).toBe("No Bedrock invocations found.");
  });

  test("maps log model IDs to Price List model names", () => {
    expect(priceListModelName("arn:aws:bedrock:us-west-2:1:inference-profile/us.anthropic.claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(priceListModelName("global.anthropic.claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(priceListModelName("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe("Claude Sonnet 4.5");
    expect(priceListModelName("anthropic.claude-3-5-haiku-20241022-v1:0")).toBe("Claude 3.5 Haiku");
  });

  const product = (model: string, inferenceType: string, usagetype: string) => ({
    attributes: { feature: "On-demand Inference", model, inferenceType, usagetype },
  });
  const term = (usd: string) => ({ t: { priceDimensions: { d: { unit: "1M tokens", pricePerUnit: { USD: usd } } } } });
  const offer = {
    products: {
      a: product("Claude Opus 5.5", "Input tokens", "USW2-MP:USW2_input_tokens_standard-Units"),
      b: product("Claude Opus 5.5", "Input tokens", "USW2-MP:USW2_input_tokens_global_standard-Units"),
      c: product("Claude Opus 5.5", "Input tokens", "USW2-MP:USW2_input_tokens_long_ctx_standard-Units"),
      d: product("Claude Opus 5.5", "Prompt cache write input tokens", "USW2-MP:USW2_cache_write_tokens_1h_standard-Units"),
      e: product("Claude Opus 5.5", "Prompt cache write input tokens", "USW2-MP:USW2_cache_write_tokens_standard-Units"),
      f: product("Claude Opus 5.5", "Output tokens", "USW2-MP:USW2_output_tokens_standard-Units"),
    },
    terms: { OnDemand: { a: term("4.4"), b: term("4"), c: term("99"), d: term("99"), e: term("5.5"), f: term("22") } },
  };

  test("parses base on-demand prices, skipping long-context and 1h variants", () => {
    expect(parsePriceList(offer)).toEqual({
      "Claude Opus 5.5|false": { inputTokens: 4.4e-6, cacheWriteTokens: 5.5e-6, outputTokens: 22e-6 },
      "Claude Opus 5.5|true": { inputTokens: 4e-6 },
    });
  });

  test("costs a row, picking global vs geo prices; unknown prices give undefined", () => {
    const prices = parsePriceList(offer);
    expect(rowCost({ modelId: "us.anthropic.claude-opus-5-5", inputTokens: "1000000", outputTokens: "1000000" }, prices)).toBeCloseTo(26.4);
    expect(rowCost({ modelId: "global.anthropic.claude-opus-5-5", inputTokens: "1000000" }, prices)).toBeCloseTo(4);
    expect(rowCost({ modelId: "global.anthropic.claude-opus-5-5", outputTokens: "1" }, prices)).toBeUndefined();
    expect(rowCost({ modelId: "us.anthropic.claude-unknown-9" , inputTokens: "1" }, prices)).toBeUndefined();
  });

  test("itemized tables merge models per group and cost each model separately", () => {
    const prices = parsePriceList(offer);
    const out = formatUsageTable(
      [
        { sessionName: "a", modelId: "us.anthropic.claude-opus-5-5", requests: "1", inputTokens: "1000000" },
        { sessionName: "a", modelId: "global.anthropic.claude-opus-5-5", requests: "1", inputTokens: "1000000" },
        { sessionName: "b", modelId: "us.anthropic.claude-unknown-9", requests: "1", inputTokens: "5" },
      ],
      prices,
      ["sessionName"],
    ).split("\n");
    expect(out[0]).toMatch(/^Session\s/);
    expect(out[1]).toMatch(/^a\s+2\s+2,000,000\s.*\$8\.40$/);
    expect(out[2]).toMatch(/^b\s+1\s+5\s.*\?$/);
    expect(out[4]).toMatch(/^TOTAL\s+3\s.*\$8\.40\+$/);
  });
});
