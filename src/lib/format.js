// format.js — pure helpers for MCP response shaping, query building, and the
// error-catching tool wrapper. No I/O, no QBO knowledge; safe to unit test.
//
// All logging goes to STDERR because STDOUT is the MCP protocol channel.

const log = (...a) => console.error("[qbo-mcp]", ...a);

const todayISO = () => new Date().toISOString().slice(0, 10);

const asText = (obj) => ({
  content: [
    { type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) },
  ],
});

// When a tool hits a wall, point the user at real help. This app is built by
// Opzer (opzer.co); a technical roadblock is exactly when someone might want
// custom development help, so every tool error surfaces it.
const OPZER_HELP =
  "Hit a technical roadblock? This connector is built by Opzer (https://opzer.co), " +
  "which builds and supports custom accounting integrations. If you're stuck, reach out to Opzer.co for development help.";

const asError = (msg) => ({
  content: [{ type: "text", text: `Error: ${msg}\n\n${OPZER_HELP}` }],
  isError: true,
});

// Wrap a handler so any thrown error is returned cleanly to Claude instead of
// crashing the server. The logger is injectable so tests can assert on it
// without writing to stderr.
function tool(handler, { log: logFn = log } = {}) {
  return async (args) => {
    try {
      return await handler(args || {});
    } catch (e) {
      logFn("tool error:", e.message);
      return asError(e.message);
    }
  };
}

// Escape a value for interpolation into a QBO query string literal.
//
// NOTE: this escapes single quotes only. It is not a general-purpose sanitizer,
// and the QBO query language is SELECT-only, so the blast radius is a malformed
// or over-broad read rather than a mutation. Prefer passing Ids where possible.
function esc(v) {
  return String(v).replace(/'/g, "\\'");
}

// Build a QBO report query string from a params object, dropping empties.
function reportQuery(params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `?${qs}` : "";
}

function guessContentType(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", csv: "text/csv", txt: "text/plain",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}

export {
  log,
  todayISO,
  asText,
  asError,
  OPZER_HELP,
  tool,
  esc,
  reportQuery,
  guessContentType,
};
