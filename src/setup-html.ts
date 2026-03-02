import type { ClaudeSettings } from "./claude-settings";

export const ENV_CHECKBOXES = [
  { key: "CLAUDE_CODE_USE_BEDROCK", value: "1", label: "Enable Bedrock" },
] as const;

export const TEXT_FIELDS = [
  { key: "ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus Model", placeholder: "global.anthropic.claude-opus-4-6" },
  { key: "ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet Model", placeholder: "global.anthropic.claude-sonnet-4-6" },
  { key: "ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku Model", placeholder: "global.anthropic.claude-haiku-4-5" },
  { key: "CLAUDE_CODE_SUBAGENT_MODEL", label: "Subagent Model", placeholder: "global.anthropic.claude-sonnet-4-6" },
  { key: "CLAUDE_CODE_MAX_OUTPUT_TOKENS", label: "Max Output Tokens", placeholder: "32000" },
  { key: "CLAUDE_CODE_MAX_THINKING_TOKENS", label: "Max Thinking Tokens", placeholder: "31999" },
] as const;

export function buildSetupHtml(env: Record<string, string>, settings: ClaudeSettings, credentialExportCmd: string) {
  const envCheckboxesHtml = ENV_CHECKBOXES.map(cb => {
    const checked = env[cb.key] === cb.value ? "checked" : "";
    return `<div class="checkbox-field">
      <input type="checkbox" id="${cb.key}" ${checked}>
      <label for="${cb.key}">${cb.label}</label>
    </div>`;
  }).join("\n  ");

  const mfaEnabled = settings.awsCredentialExport !== undefined || env.AWS_SHARED_CREDENTIALS_FILE === "/dev/null";
  const mfaCheckboxHtml = `<div class="checkbox-field">
      <input type="checkbox" id="enableMfa" ${mfaEnabled ? "checked" : ""}>
      <label for="enableMfa">Enable claude-aws-mfa</label>
    </div>`;

  const textFieldsHtml = TEXT_FIELDS.map(f => {
    const val = env[f.key] ?? "";
    return `<div class="field">
      <label for="${f.key}">${f.label}</label>
      <input type="text" id="${f.key}" value="${escapeAttr(val)}" placeholder="${escapeAttr(f.placeholder)}">
    </div>`;
  }).join("\n  ");

  return /*html*/ `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    padding: 20px; background: #f5f5f7; color: #1d1d1f;
  }
  h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .field { margin-bottom: 12px; }
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; color: #1d1d1f; }
  input[type="text"] {
    width: 100%; padding: 8px 10px; border: 1px solid #d2d2d7;
    border-radius: 6px; font-size: 14px; background: #fff; outline: none;
  }
  input[type="text"]:focus { border-color: #0071e3; box-shadow: 0 0 0 2px rgba(0,113,227,0.2); }
  .checkbox-field {
    display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  }
  .checkbox-field input[type="checkbox"] {
    width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;
  }
  .checkbox-field label {
    display: inline; margin-bottom: 0; font-size: 13px; cursor: pointer;
  }
  hr { border: none; border-top: 1px solid #d2d2d7; margin: 16px 0; }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  button {
    padding: 8px 20px; border-radius: 6px; font-size: 14px; cursor: pointer;
    border: 1px solid #d2d2d7; background: #fff; color: #1d1d1f;
  }
  button.primary { background: #0071e3; color: #fff; border-color: #0071e3; }
  button:hover { filter: brightness(0.95); }
</style>
</head>
<body>
  <h2>Claude Code Bedrock Setup</h2>

  ${envCheckboxesHtml}
  ${mfaCheckboxHtml}

  <hr>

  ${textFieldsHtml}

  <div class="buttons">
    <button onclick="_cancel()">Cancel</button>
    <button class="primary" onclick="save()">Save</button>
  </div>

  <script>
    const ENV_CHECKBOXES = ${JSON.stringify(ENV_CHECKBOXES)};
    const TEXT_FIELDS = ${JSON.stringify(TEXT_FIELDS)};
    const originalEnv = ${JSON.stringify(env)};
    const originalSettings = ${JSON.stringify(settings)};
    const credentialExportCmd = ${JSON.stringify(credentialExportCmd)};

    function save() {
      const env = {};
      const top = {};

      for (const cb of ENV_CHECKBOXES) {
        const el = document.getElementById(cb.key);
        if (el.checked) {
          env[cb.key] = cb.value;
        } else if (originalEnv[cb.key] === cb.value) {
          env[cb.key] = null;
        }
      }

      // Combined "Enable claude-aws-mfa" checkbox controls both
      // awsCredentialExport (top-level) and AWS_SHARED_CREDENTIALS_FILE (env)
      const mfaChecked = document.getElementById("enableMfa").checked;
      if (mfaChecked) {
        top["awsCredentialExport"] = credentialExportCmd;
        env["AWS_SHARED_CREDENTIALS_FILE"] = "/dev/null";
      } else {
        if (originalSettings["awsCredentialExport"] !== undefined) {
          top["awsCredentialExport"] = null;
        }
        if (originalEnv["AWS_SHARED_CREDENTIALS_FILE"] === "/dev/null") {
          env["AWS_SHARED_CREDENTIALS_FILE"] = null;
        }
      }

      for (const f of TEXT_FIELDS) {
        const el = document.getElementById(f.key);
        const val = el.value.trim();
        if (val) {
          env[f.key] = val;
        } else if (originalEnv[f.key] !== undefined) {
          env[f.key] = null;
        }
      }

      _submit(JSON.stringify({ env, top }));
    }

    document.addEventListener("keydown", e => {
      if (e.key === "Enter") return save();
      if (e.key === "Escape") return _cancel();
    });
  </script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
