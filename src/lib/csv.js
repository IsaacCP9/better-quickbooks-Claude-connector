// csv.js — bank-statement CSV parsing and the import planning pipeline.
//
// Split out of the import_transactions_from_csv tool so each stage (parse →
// detect columns → categorize → plan → batch) can be tested on its own. All
// functions here are pure: no fs, no network.

// Parse a simple CSV (handles quoted fields and commas inside quotes).
function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Locate the date / description / amount columns in a header row by substring
// match. Returns -1 for any column that couldn't be found.
function detectColumns(headerRow) {
  const header = headerRow.map((h) => h.trim().toLowerCase());
  return {
    dateIdx: header.findIndex((h) => h.includes("date")),
    descIdx: header.findIndex(
      (h) => h.includes("desc") || h.includes("memo") || h.includes("payee") || h.includes("name")
    ),
    amtIdx: header.findIndex((h) => h.includes("amount") || h.includes("debit") || h === "amt"),
  };
}

// Strip currency symbols, thousands separators and stray text, then take the
// magnitude — bank exports sign debits inconsistently. Unparseable → 0.
function parseAmount(raw) {
  return Math.abs(parseFloat(String(raw ?? "0").replace(/[^0-9.\-]/g, ""))) || 0;
}

// The account rows land in when nothing matches: an explicitly "Uncategorized"
// account if the chart has one, otherwise the first expense account.
function pickFallbackAccount(accounts) {
  return accounts.find((a) => /uncategorized/i.test(a.Name)) || accounts[0];
}

// Guess an expense account from a transaction description.
//
// The rule is deliberately crude: the first word of an account's name appearing
// anywhere in the description wins, first match in chart order. That means
// "Office Supplies" claims any description containing "office", and short or
// generic first words over-match. Callers should treat the result as a
// suggestion for a human to review, which is why dry_run exists.
function categorizeRow(description, accounts, fallback) {
  const d = String(description).toLowerCase();
  const match = accounts.find((a) => {
    if (!a.Name) return false;
    const firstWord = a.Name.toLowerCase().split(" ")[0];
    // An account name starting with whitespace yields "" here, and
    // "".includes() is always true — skip it rather than matching everything.
    if (!firstWord) return false;
    return d.includes(firstWord);
  });
  return match || fallback;
}

// Turn parsed CSV rows into the planned import: one entry per usable data row.
// Rows too short to contain all three columns, and rows with no positive amount,
// are dropped.
function planImportRows({ rows, columns, accounts, fallback }) {
  const { dateIdx, descIdx, amtIdx } = columns;
  const widest = Math.max(dateIdx, descIdx, amtIdx);
  return rows
    .slice(1)
    .filter((r) => r.length > widest)
    .map((r) => {
      const description = (r[descIdx] || "").trim();
      const amount = parseAmount(r[amtIdx]);
      const cat = categorizeRow(description, accounts, fallback);
      return {
        date: (r[dateIdx] || "").trim(),
        description,
        amount,
        category: cat?.Name,
        category_id: cat?.Id,
      };
    })
    .filter((p) => p.amount > 0);
}

// Shape planned rows into QBO batch create operations for Purchase (Expense)
// transactions drawn on `bank`.
function buildPurchaseBatchItems(planned, bank, fallbackDate) {
  return planned.map((p, i) => ({
    bId: `bid${i}`,
    operation: "create",
    Purchase: {
      PaymentType: "Check",
      AccountRef: { value: bank.Id, name: bank.Name },
      TxnDate: p.date || fallbackDate,
      PrivateNote: p.description,
      Line: [{
        Amount: p.amount,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: { value: p.category_id, name: p.category } },
      }],
    },
  }));
}

// QBO's batch endpoint caps at 30 operations per request.
const QBO_BATCH_LIMIT = 30;

function chunk(items, size = QBO_BATCH_LIMIT) {
  if (!(size > 0)) throw new Error("chunk size must be a positive number");
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export {
  parseCSV,
  detectColumns,
  parseAmount,
  pickFallbackAccount,
  categorizeRow,
  planImportRows,
  buildPurchaseBatchItems,
  chunk,
  QBO_BATCH_LIMIT,
};
