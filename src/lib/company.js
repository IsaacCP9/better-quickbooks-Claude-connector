// company.js — which QuickBooks company does this call target?
//
// This module owns the write gate: the rule that a tool which *changes* books
// must never guess the company. It also owns the session default, so the mutable
// state lives next to the rule that depends on it rather than in a global.
//
// Resolution precedence, per call:
//   explicit `company` arg → session default → env QBO_COMPANY → sole company
//   (reads only) → error listing the available companies.

function formatCompanyList(companies) {
  return (
    companies.map((c) => `${c.slug} (${c.environment}, realm ${c.realmId})`).join("; ") ||
    "none — authorize one with `QBO_COMPANY=<slug> npm run connect`"
  );
}

// Build a resolver bound to a company source. `listCompanies` and `sanitizeSlug`
// are injected so the precedence rules can be tested without touching disk.
function createCompanyResolver({ listCompanies, sanitizeSlug, env = process.env }) {
  // The session default set via select_company (until the server restarts).
  let sessionDefault = null;

  const getSessionDefault = () => sessionDefault;
  const setSessionDefault = (slug) => {
    sessionDefault = slug;
    return sessionDefault;
  };

  const envDefaultCompany = () => sanitizeSlug(env.QBO_COMPANY || "");

  // Resolve which company a call targets, enforcing the precedence + write-gate.
  // Returns a concrete slug string ("" = the legacy default tokens.json).
  async function resolveCompany(explicit, { write = false } = {}) {
    // 1. Explicit per-call argument — validated against what's actually authorized.
    if (explicit != null && String(explicit).trim() !== "") {
      const slug = sanitizeSlug(explicit);
      const companies = await listCompanies();
      if (!companies.some((c) => c.slug === slug)) {
        throw new Error(
          `No such company "${explicit}". Available: ${formatCompanyList(companies)}.`
        );
      }
      return slug;
    }
    // 2. Session default (set via select_company).
    if (sessionDefault) return sessionDefault;
    // 3. Env default (legacy per-connector QBO_COMPANY).
    const envDefault = envDefaultCompany();
    if (envDefault) return envDefault;
    // 4. Convenience fallbacks.
    const companies = await listCompanies();
    //
    // KNOWN GAP (documented in SECURITY.md → Known limitations): listCompanies()
    // deliberately skips the legacy `tokens.json` filename, so a single-company
    // install authorized with a bare `npm run connect` lands here with an empty
    // list and returns "" for WRITES TOO — the write gate below never runs. See
    // test/company.test.js, which pins this behaviour so a future fix is a
    // deliberate, visible change rather than an accident.
    if (companies.length === 0) return ""; // pure legacy single-file / default connector
    if (companies.length === 1 && !write) return companies[0].slug;
    // 5. Ambiguous — never guess.
    const why = write
      ? "I won't guess which company to post a write to"
      : "multiple companies are connected";
    throw new Error(
      `No company selected — ${why}. Pass a \`company\` argument or call select_company first. Available: ${formatCompanyList(companies)}.`
    );
  }

  return {
    resolveCompany,
    envDefaultCompany,
    getSessionDefault,
    setSessionDefault,
  };
}

export { formatCompanyList, createCompanyResolver };
