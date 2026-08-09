// builders.js — entity lookups and QBO line-item construction.
//
// Everything here talks to QuickBooks through an injected client
// ({ qboQuery, qboRequest }) rather than importing it, so the reference
// resolution and line-shaping rules can be tested against a fake.

import { esc } from "./format.js";

function createBuilders({ qboQuery, qboRequest }) {
  // ---- entity lookups (all company-scoped) ---------------------------------
  async function findCustomerByName(name, company) {
    const r = await qboQuery(`SELECT * FROM Customer WHERE DisplayName = '${esc(name)}'`, { company });
    return r.Customer?.[0] || null;
  }
  async function findVendorByName(name, company) {
    const r = await qboQuery(`SELECT * FROM Vendor WHERE DisplayName = '${esc(name)}'`, { company });
    return r.Vendor?.[0] || null;
  }
  async function findAccountByName(name, company) {
    const r = await qboQuery(`SELECT * FROM Account WHERE Name = '${esc(name)}'`, { company });
    return r.Account?.[0] || null;
  }
  async function findAnyIncomeAccount(company) {
    const r = await qboQuery(`SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1`, { company });
    return r.Account?.[0] || null;
  }
  async function findAnyServiceItem(company) {
    const r = await qboQuery(`SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1`, { company });
    return r.Item?.[0] || null;
  }

  // ---- shared ref helpers ---------------------------------------------------
  // Resolve a name-or-Id to a QBO {value, name} reference for any entity.
  // A purely numeric input is treated as an Id; anything else as a name.
  async function resolveRef(entity, nameOrId, company, nameField = "DisplayName") {
    if (/^\d+$/.test(String(nameOrId))) {
      const rec = (await qboQuery(`SELECT * FROM ${entity} WHERE Id = '${esc(nameOrId)}'`, { company }))[entity]?.[0];
      return rec ? { value: rec.Id, name: rec[nameField] || rec.Name } : { value: String(nameOrId) };
    }
    const rec = (await qboQuery(`SELECT * FROM ${entity} WHERE ${nameField} = '${esc(nameOrId)}'`, { company }))[entity]?.[0];
    if (!rec) throw new Error(`${entity} not found: "${nameOrId}"`);
    return { value: rec.Id, name: rec[nameField] || rec.Name };
  }

  // Fetch a full entity record (for its SyncToken) before a sparse update / void / delete.
  async function fetchEntity(entity, id, company) {
    const rec = (await qboQuery(`SELECT * FROM ${entity} WHERE Id = '${esc(id)}'`, { company }))[entity]?.[0];
    if (!rec) throw new Error(`No ${entity} with Id ${id}`);
    return rec;
  }

  // ---- journal entries ------------------------------------------------------
  // Resolve a customer/vendor/employee referenced on a journal line to its Id.
  async function resolveEntityId(name, type, company) {
    const r = await qboQuery(`SELECT * FROM ${type} WHERE DisplayName = '${esc(name)}'`, { company });
    const rec = r[type]?.[0];
    if (!rec) throw new Error(`${type} not found for journal-line entity: "${name}"`);
    return rec.Id;
  }

  // Turn the ergonomic line schema into QBO JournalEntryLineDetail lines, resolving
  // account (and any entity) references and asserting the entry balances.
  async function buildJournalLines(lines, company) {
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new Error("A journal entry needs at least two lines, with total debits equal to total credits.");
    }
    let debit = 0, credit = 0;
    const out = [];
    for (const li of lines) {
      let acct;
      if (/^\d+$/.test(String(li.account))) {
        const found = (await qboQuery(`SELECT * FROM Account WHERE Id = '${esc(li.account)}'`, { company })).Account?.[0];
        acct = found ? { Id: found.Id, Name: found.Name } : { Id: String(li.account) };
      } else {
        const found = await findAccountByName(li.account, company);
        if (!found) throw new Error(`Account not found for journal line: "${li.account}"`);
        acct = { Id: found.Id, Name: found.Name };
      }
      const detail = {
        PostingType: li.posting_type,
        AccountRef: { value: acct.Id, ...(acct.Name ? { name: acct.Name } : {}) },
      };
      if (li.entity_name) {
        if (!li.entity_type) throw new Error(`entity_type is required when entity_name is set (line account "${li.account}").`);
        detail.Entity = { Type: li.entity_type, EntityRef: { value: await resolveEntityId(li.entity_name, li.entity_type, company) } };
      }
      const line = { Amount: li.amount, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: detail };
      if (li.description) line.Description = li.description;
      out.push(line);
      if (li.posting_type === "Debit") debit += Number(li.amount);
      else credit += Number(li.amount);
    }
    if (Math.abs(debit - credit) > 0.005) {
      throw new Error(`Journal entry is not balanced: debits ${debit.toFixed(2)} vs credits ${credit.toFixed(2)}.`);
    }
    return out;
  }

  async function readJournalEntry(id, company) {
    const r = await qboRequest(`/journalentry/${encodeURIComponent(id)}`, { company });
    const entry = r.JournalEntry;
    if (!entry) throw new Error(`No journal entry with Id ${id}`);
    return entry;
  }

  // ---- line builders --------------------------------------------------------
  // Sales transactions (Invoice/Estimate/SalesReceipt/CreditMemo/RefundReceipt).
  async function buildSalesLines(lines, company) {
    const out = [];
    for (const li of lines) {
      const detail = {};
      if (li.item) detail.ItemRef = await resolveRef("Item", li.item, company, "Name");
      else { const it = await findAnyServiceItem(company); if (it) detail.ItemRef = { value: it.Id, name: it.Name }; }
      if (li.quantity != null) detail.Qty = li.quantity;
      if (li.unit_price != null) detail.UnitPrice = li.unit_price;
      const line = { Amount: li.amount, DetailType: "SalesItemLineDetail", SalesItemLineDetail: detail };
      if (li.description) line.Description = li.description;
      out.push(line);
    }
    return out;
  }

  // Account-based expense lines (account-based Bill / Expense / VendorCredit).
  async function buildAccountLines(lines, company) {
    const out = [];
    for (const li of lines) {
      const line = {
        Amount: li.amount,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: await resolveRef("Account", li.account, company, "Name") },
      };
      if (li.description) line.Description = li.description;
      out.push(line);
    }
    return out;
  }

  // Item-based expense lines (item-based Bill / PurchaseOrder).
  async function buildItemExpenseLines(lines, company) {
    const out = [];
    for (const li of lines) {
      const detail = { ItemRef: await resolveRef("Item", li.item, company, "Name") };
      if (li.quantity != null) detail.Qty = li.quantity;
      if (li.unit_price != null) detail.UnitPrice = li.unit_price;
      const line = { Amount: li.amount, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: detail };
      if (li.description) line.Description = li.description;
      out.push(line);
    }
    return out;
  }

  // Deposit lines.
  async function buildDepositLines(lines, company) {
    const out = [];
    for (const li of lines) {
      const detail = { AccountRef: await resolveRef("Account", li.account, company, "Name") };
      if (li.entity_name) {
        if (!li.entity_type) throw new Error("entity_type is required when entity_name is set on a deposit line.");
        detail.Entity = await resolveRef(li.entity_type, li.entity_name, company, "DisplayName");
      }
      const line = { Amount: li.amount, DetailType: "DepositLineDetail", DepositLineDetail: detail };
      if (li.description) line.Description = li.description;
      out.push(line);
    }
    return out;
  }

  return {
    findCustomerByName,
    findVendorByName,
    findAccountByName,
    findAnyIncomeAccount,
    findAnyServiceItem,
    resolveRef,
    fetchEntity,
    resolveEntityId,
    buildJournalLines,
    readJournalEntry,
    buildSalesLines,
    buildAccountLines,
    buildItemExpenseLines,
    buildDepositLines,
  };
}

export { createBuilders };
