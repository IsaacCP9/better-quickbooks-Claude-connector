// schemas.js — zod shapes shared across the tool definitions.
// Kept separate so the line-item contracts can be asserted in isolation.

import { z } from "zod";

const companyArg = z
  .string()
  .optional()
  .describe("Company slug to run against (see list_companies). Omit to use the active/default company.");

// One line of a journal entry. Debits and credits across all lines must balance.
const journalLineSchema = z.object({
  account: z.string().describe("Account name or Id to post this line to"),
  amount: z.number().positive().describe("Positive amount; direction is set by posting_type"),
  posting_type: z.enum(["Debit", "Credit"]),
  description: z.string().optional().describe("Per-line memo"),
  entity_name: z.string().optional().describe("Optional customer/vendor/employee to tag this line to"),
  entity_type: z.enum(["Customer", "Vendor", "Employee"]).optional().describe("Required if entity_name is set"),
});

// Line schemas shared across the transaction tools.
const salesLineSchema = z.object({
  amount: z.number().describe("Line amount"),
  item: z.string().optional().describe("Product/Service name or Id (defaults to any Service item)"),
  description: z.string().optional(),
  quantity: z.number().optional(),
  unit_price: z.number().optional(),
});

const accountLineSchema = z.object({
  account: z.string().describe("Account name or Id to categorize against"),
  amount: z.number(),
  description: z.string().optional(),
});

const itemLineSchema = z.object({
  item: z.string().describe("Product/Service name or Id"),
  amount: z.number(),
  quantity: z.number().optional(),
  unit_price: z.number().optional(),
  description: z.string().optional(),
});

const depositLineSchema = z.object({
  account: z.string().describe("Source account name or Id (e.g. an income account or Undeposited Funds)"),
  amount: z.number(),
  description: z.string().optional(),
  entity_name: z.string().optional(),
  entity_type: z.enum(["Customer", "Vendor", "Employee"]).optional(),
});

export {
  companyArg,
  journalLineSchema,
  salesLineSchema,
  accountLineSchema,
  itemLineSchema,
  depositLineSchema,
};
