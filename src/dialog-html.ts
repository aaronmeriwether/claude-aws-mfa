export const FIELDS = ["region", "accessKeyId", "secretAccessKey", "mfaArn", "roleArn", "duration", "mfaCode"] as const;

export const FIELD_PATTERNS: Record<string, string> = {
  region: "^[a-z]{2}(-[a-z]+-\\d+)$",
  accessKeyId: "^(AKIA|ASIA)[A-Z0-9]{16}$",
  secretAccessKey: "^[A-Za-z0-9/+=]{40}$",
  mfaArn: "^arn:aws:iam::\\d{12}:mfa/.+$",
  roleArn: "^arn:aws:iam::\\d{12}:role/.+$",
  duration: "^[1-9]\\d*$",
  mfaCode: "^\\d{6}$",
};

export function buildHtml(config: Record<string, string>) {
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
  label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; transition: color 0.15s; }
  label.valid { color: #1d1d1f; }
  label.invalid { color: #ff3b30; }
  label.empty { color: #6e6e73; }
  input {
    width: 100%; padding: 8px 10px; border: 1px solid #d2d2d7;
    border-radius: 6px; font-size: 14px; background: #fff; outline: none;
  }
  input:focus { border-color: #0071e3; box-shadow: 0 0 0 2px rgba(0,113,227,0.2); }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  button {
    padding: 8px 20px; border-radius: 6px; font-size: 14px; cursor: pointer;
    border: 1px solid #d2d2d7; background: #fff; color: #1d1d1f;
  }
  button.primary { background: #0071e3; color: #fff; border-color: #0071e3; }
  button:hover { filter: brightness(0.95); }
  hr { border: none; border-top: 1px solid #d2d2d7; margin: 16px 0; }
</style>
</head>
<body>
  <h2>Claude AWS MFA</h2>
  <div class="field"><label>AWS Region</label><input id="region" placeholder="us-east-1"></div>
  <div class="field"><label>Access Key ID</label><input id="accessKeyId" type="password" placeholder="AKIA..."></div>
  <div class="field"><label>Secret Access Key</label><input id="secretAccessKey" type="password"></div>
  <div class="field"><label>MFA Device ARN</label><input id="mfaArn" placeholder="arn:aws:iam::123456789012:mfa/user"></div>
  <div class="field"><label>Role ARN</label><input id="roleArn" placeholder="arn:aws:iam::123456789012:role/MyRole"></div>
  <div class="field"><label>Session Duration (seconds)</label><input id="duration" placeholder="43200"></div>
  <hr>
  <div class="field"><label>MFA Code</label><input id="mfaCode" placeholder="123456"></div>
  <div class="buttons">
    <button onclick="_cancel()">Cancel</button>
    <button class="primary" onclick="submit()">OK</button>
  </div>
  <script>
    const FIELDS = ${JSON.stringify(FIELDS)};
    const PATTERNS = ${JSON.stringify(FIELD_PATTERNS)};
    const config = ${JSON.stringify(config)};

    for (const [k, v] of Object.entries(config))
      if (document.getElementById(k)) document.getElementById(k).value = v;

    function validateField(id) {
      const input = document.getElementById(id);
      const label = input.parentElement.querySelector("label");
      const pattern = PATTERNS[id];
      if (!pattern) { label.className = "empty"; return; }
      if (!input.value) { label.className = "empty"; return; }
      label.className = new RegExp(pattern).test(input.value) ? "valid" : "invalid";
    }

    for (const id of FIELDS) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", () => validateField(id));
        validateField(id);
      }
    }

    document.getElementById("mfaCode").focus();

    function submit() {
      _submit(JSON.stringify(Object.fromEntries(
        FIELDS.map(id => [id, document.getElementById(id).value])
      )));
    }

    // Try the browser Clipboard API first (no external process needed).
    // Falls back to _paste() which spawns a platform helper on the Bun side.
    async function readClipboard() {
      try {
        if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
      } catch {}
      return await _paste();
    }

    document.addEventListener("keydown", async e => {
      if (e.key === "Enter") return submit();
      if (e.key === "Escape") return _cancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        e.preventDefault();
        const text = await readClipboard();
        const el = document.activeElement;
        if (el?.tagName === "INPUT") {
          const start = el.selectionStart, end = el.selectionEnd;
          el.value = el.value.slice(0, start) + text + el.value.slice(end);
          el.selectionStart = el.selectionEnd = start + text.length;
          el.dispatchEvent(new Event("input"));
        }
      }
    });
  </script>
</body>
</html>`;
}
