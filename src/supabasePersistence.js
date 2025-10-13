import { isSupabaseConfigured, supabaseInsert, supabaseWorkspaceId } from "./supabaseClient";

function ensureArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export async function persistInvoiceRecord({
  invoiceNo,
  customerName,
  meta,
  items,
  totals,
  pdfColumnPrefs,
  source,
}) {
  if (!isSupabaseConfigured) return;
  const payload = {
    workspace_id: supabaseWorkspaceId,
    invoice_no: invoiceNo || null,
    customer_name: customerName || null,
    meta: meta || {},
    items: ensureArray(items),
    totals: totals || {},
    pdf_column_prefs: pdfColumnPrefs || {},
    source: source || "manual",
    created_at: new Date().toISOString(),
  };
  try {
    await supabaseInsert("invoices", [payload], { returning: "minimal" });
  } catch (error) {
    console.error("Failed to persist invoice record", error);
  }
}
