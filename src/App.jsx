import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import JSZip from "jszip";
import * as FileSaver from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import dayjs from "dayjs";
import { useSupabaseSync } from "./useSupabaseSync";
import { persistInvoiceRecord } from "./supabasePersistence";
import {
  isSupabaseConfigured,
  supabaseUrlError,
  supabaseWorkspaceId,
} from "./supabaseClient";

const saveAs = FileSaver.saveAs || FileSaver.default;

function usePersistentState(key, defaultValue) {
  const getDefault = () =>
    typeof defaultValue === "function" ? defaultValue() : defaultValue;
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return getDefault();
    const stored = window.localStorage.getItem(key);
    if (stored === null) return getDefault();
    try {
      return JSON.parse(stored);
    } catch {
      return getDefault();
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore storage errors */
    }
  }, [key, value]);
  return [value, setValue];
}

// Currency without rupee glyph to avoid jsPDF helvetica fallback rendering '1'
function formatINR(n){
  const num = Number(n || 0);
  return "Rs " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num);
}
function formatQuantity(n){
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n || 0));
}
const BELOW_TWENTY = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety"
];
const INDIAN_UNITS = ["", "Thousand", "Lakh", "Crore", "Arab", "Kharab"];

const BRAND_OPTIONS = [
  {
    id: "garani",
    name: "GARANI PUBLICATION",
    address:
      "Old No.5A, New E351, 7th A Main Road, MSR Layout, Havanuru Layout,\nBengaluru Urban, Bengaluru, Karnataka, 560073",
    phone: "Mobile: 9108447657",
    gstin: "GSTIN: 29CBIPN0092E1ZM",
    fonts: {
      heading: { size: 18 },
      subheading: { size: 10 },
      tableHead: { size: 10 },
      summaryTitle: { size: 13 },
      summaryValue: { size: 15 },
      summaryHighlight: { size: 18 }
    }
  },
  {
    id: "yogi",
    name: "YOGI Books and Stationary",
    address:
      "No. 2/1/33, SBI Staff Colony, Hoshalli Extension, Stage 1, Vijayanagar,\nBengaluru, Karnataka 560040",
    phone: "Mobile: 9743402605",
    gstin: "GSTIN: 29ENSPB8959Q1ZK",
    fonts: {
      heading: { family: "times", size: 20 },
      subheading: { family: "times", size: 11 },
      tableHead: { family: "times", size: 10 },
      tableBody: { family: "times", size: 10 },
      summaryTitle: { family: "times", size: 13 },
      summaryLabel: { family: "times", size: 10 },
      summaryValue: { family: "times", size: 15 },
      summaryHighlight: { family: "times", size: 18 },
      amountLabel: { family: "times", size: 11 },
      amountValue: { family: "times", size: 11 },
      terms: { family: "times", style: "italic", size: 10 }
    }
  },
  {
    id: "sadhana",
    name: "Sadhana BM Pvt Ltd",
    address:
      "No- 12, 2nd Floor, 2nd Stage Binny Layout, Attiguppe, Vijaynagar,\nBangalore, Karnataka, India 560040",
    phone: "Mobile: 7204039904",
    gstin: "GSTIN: 29ABGCS5683MIZG",
    fonts: {
      heading: { family: "courier", size: 18 },
      subheading: { family: "courier", size: 9 },
      tableHead: { family: "courier", size: 9 },
      tableBody: { family: "courier", size: 9 },
      summaryTitle: { family: "courier", size: 12 },
      summaryLabel: { family: "courier", size: 9 },
      summaryValue: { family: "courier", size: 13 },
      summaryHighlight: { family: "courier", size: 16 },
      amountLabel: { family: "courier", size: 10 },
      amountValue: { family: "courier", size: 10 },
      terms: { family: "courier", style: "italic", size: 9 }
    }
  },
];

const BRAND_LOOKUP = BRAND_OPTIONS.reduce((acc, option) => {
  acc[option.id] = option;
  return acc;
}, {});

const DEFAULT_BRAND_KEY = BRAND_OPTIONS[0].id;

const DEFAULT_BRAND_FONTS = Object.freeze({
  heading: { family: "helvetica", style: "bold", size: 16 },
  subheading: { family: "helvetica", style: "normal", size: 9 },
  tableHead: { family: "helvetica", style: "bold", size: 9 },
  tableBody: { family: "helvetica", style: "normal", size: 9 },
  summaryTitle: { family: "helvetica", style: "bold", size: 12 },
  summaryLabel: { family: "helvetica", style: "bold", size: 9 },
  summaryValue: { family: "helvetica", style: "bold", size: 14 },
  summaryHighlight: { family: "helvetica", style: "bold", size: 16 },
  amountLabel: { family: "helvetica", style: "bold", size: 10 },
  amountValue: { family: "helvetica", style: "normal", size: 10 },
  terms: { family: "helvetica", style: "normal", size: 9 }
});

function mergeFontStyles(overrides) {
  const merged = {};
  const extras = overrides || {};
  Object.keys(DEFAULT_BRAND_FONTS).forEach((key) => {
    merged[key] = { ...DEFAULT_BRAND_FONTS[key], ...(extras[key] || {}) };
  });
  Object.keys(extras).forEach((key) => {
    if (!merged[key]) {
      merged[key] = { family: "helvetica", style: "normal", size: 10, ...extras[key] };
    }
  });
  return merged;
}

function applyFont(doc, fontSpec) {
  const { family = "helvetica", style = "normal", size = 10 } = fontSpec || {};
  doc.setFont(family, style);
  doc.setFontSize(size);
}

function normalizeBrandKey(value) {
  if (!value) return DEFAULT_BRAND_KEY;
  const text = String(value).trim().toLowerCase();
  return BRAND_LOOKUP[text] ? text : DEFAULT_BRAND_KEY;
}
function convertBelowThousand(num){
  let value = num % 1000;
  const parts = [];
  if(value >= 100){
    parts.push(`${BELOW_TWENTY[Math.floor(value / 100)]} Hundred`);
    value %= 100;
  }
  if(value >= 20){
    const tenWord = TENS[Math.floor(value / 10)];
    const remainder = value % 10;
    parts.push(remainder ? `${tenWord} ${BELOW_TWENTY[remainder]}` : tenWord);
  }else if(value > 0){
    parts.push(BELOW_TWENTY[value]);
  }
  return parts.join(" ").trim();
}
function numberToIndianWords(num){
  const value = Math.floor(Math.abs(num));
  if(value === 0) return "Zero";
  let remainder = value;
  let unitIndex = 0;
  const words = [];
  while(remainder > 0 && unitIndex < INDIAN_UNITS.length){
    const divisor = unitIndex === 0 ? 1000 : 100;
    const chunk = remainder % divisor;
    remainder = Math.floor(remainder / divisor);
    if(chunk){
      const chunkWords = convertBelowThousand(chunk);
      const label = INDIAN_UNITS[unitIndex];
      words.unshift(label ? `${chunkWords} ${label}`.trim() : chunkWords);
    }
    unitIndex += 1;
  }
  if(remainder > 0){
    words.unshift(numberToIndianWords(remainder) + ` ${INDIAN_UNITS[INDIAN_UNITS.length - 1]}`);
  }
  return words.join(" ").trim();
}
function numberToIndianCurrencyWords(amount){
  const numeric = Number(amount || 0);
  if(!Number.isFinite(numeric)) return "Zero Rupees Only";
  const isNegative = numeric < 0;
  const absolute = Math.abs(numeric);
  const paiseTotal = Math.round(absolute * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const rupeeWords = numberToIndianWords(rupees);
  const parts = [];
  if(rupees > 0){
    parts.push(`${rupeeWords} ${rupees === 1 ? "Rupee" : "Rupees"}`);
  }else{
    parts.push("Zero Rupees");
  }
  if(paise > 0){
    parts.push(`${numberToIndianWords(paise)} ${paise === 1 ? "Paisa" : "Paise"}`);
  }
  let phrase = parts.join(" and ");
  if(isNegative) phrase = `Minus ${phrase}`;
  return `${phrase} Only`;
}

const BOOK_ORDER_BY = Object.freeze({ column:"title", ascending:true });
const CUSTOMER_ORDER_BY = Object.freeze({ column:"invoice_no", ascending:true });
const DRAFT_ORDER_BY = Object.freeze({ column:"updated_at", ascending:false });

function bookIdentity(book){
  if(!book) return null;
  return book.uid || buildBookUid({ sku:book.sku, title:book.title });
}

function customerIdentity(customer){
  if(!customer) return null;
  return (
    customer.uid ||
    buildCustomerUid(
      customer.invoice_no,
      customer.customer_name,
      customer.gstin
    )
  );
}

function draftIdentity(draft){
  if(!draft) return null;
  return draft.id || draft.uid || null;
}
function asNumber(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }

function parseOrderValue(value){
  if(value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeInvoiceLines(lines){
  if(!Array.isArray(lines)) return [];
  let changed=false;
  const normalized=lines.map((line, idx)=>{
    const parsed=parseOrderValue(line?.order);
    if(parsed===null){
      changed=true;
      return { ...line, order: idx+1 };
    }
    if(line.order!==parsed){
      changed=true;
      return { ...line, order: parsed };
    }
    return line;
  });
  return changed?normalized:lines;
}

function nextInvoiceLineOrder(lines){
  if(!Array.isArray(lines) || !lines.length) return 1;
  let max=0;
  lines.forEach((line, idx)=>{
    const parsed=parseOrderValue(line?.order);
    if(parsed===null){
      max=Math.max(max, idx+1);
    }else{
      max=Math.max(max, parsed);
    }
  });
  return max+1;
}

function sortLinesByOrderValue(lines){
  const list=Array.isArray(lines)?lines:[];
  return list
    .map((line, idx)=>({ line, idx }))
    .sort((a,b)=>{
      const orderA=parseOrderValue(a.line?.order);
      const orderB=parseOrderValue(b.line?.order);
      const valueA=orderA??(a.idx+1);
      const valueB=orderB??(b.idx+1);
      if(valueA!==valueB) return valueA-valueB;
      return a.idx-b.idx;
    })
    .map(entry=>entry.line);
}

function prepareLinesForExport(lines){
  return sortLinesByOrderValue(lines).map((line)=>{
    const normalizedOrder=parseOrderValue(line?.order);
    const clone={ ...line };
    if(normalizedOrder===null){
      delete clone.order;
    }else{
      clone.order=normalizedOrder;
    }
    return clone;
  });
}

function randomId(prefix = "id"){
  if(typeof crypto !== "undefined" && crypto.randomUUID){
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function slugifyKey(value){
  if(value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if(!text) return null;
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildBookUid({ sku, title, uid }){
  if(uid) return uid;
  const skuSlug = slugifyKey(sku);
  if(skuSlug) return `book_${skuSlug}`;
  const titleSlug = slugifyKey(title);
  if(titleSlug) return `book_${titleSlug}`;
  return randomId("book");
}

function normalizeBook(input = {}){
  const sku = input.sku ?? input.SKU ?? "";
  const title = input.title ?? input.Title ?? input.book_title ?? "";
  const author = input.author ?? input.Author ?? "";
  const publisher = input.publisher ?? input.Publisher ?? "";
  const mrp = asNumber(input.mrp ?? input.MRP ?? input.price ?? 0, 0);
  const defaultDiscount = asNumber(
    input.default_discount_pct ?? input.discount ?? input.default_discount ?? 0,
    0
  );
  const defaultTax = asNumber(
    input.default_tax_pct ?? input.tax ?? input.gst ?? input.default_tax ?? 0,
    0
  );
  const record = {
    uid: buildBookUid({ sku, title, uid: input.uid ?? input.id }),
    sku: String(sku || "").trim(),
    title: String(title || "").trim(),
    author: String(author || "").trim(),
    publisher: String(publisher || "").trim(),
    mrp,
    default_discount_pct: defaultDiscount,
    default_tax_pct: defaultTax,
  };
  const createdAt = input.createdAt ?? input.created_at;
  const updatedAt = input.updatedAt ?? input.updated_at ?? createdAt;
  if(createdAt) record.createdAt = createdAt;
  if(updatedAt) record.updatedAt = updatedAt;
  return record;
}

function buildCustomerUid(invoiceNo, name, gstin, uid){
  if(uid) return uid;
  const invoiceSlug = slugifyKey(invoiceNo);
  if(invoiceSlug) return `customer_${invoiceSlug}`;
  const gstSlug = slugifyKey(gstin);
  if(gstSlug) return `customer_${gstSlug}`;
  const nameSlug = slugifyKey(name);
  if(nameSlug) return `customer_${nameSlug}`;
  return randomId("customer");
}

function normalizeCustomer(input = {}){
  const invoiceNo = input.invoice_no ?? input.invoiceNo ?? input.InvoiceNo ?? "";
  const customerName =
    input.customer_name ??
    input.customerName ??
    input.CustomerName ??
    input.customer ??
    input.Customer ??
    "";
  const billingAddress =
    input.billing_address ??
    input.billingAddress ??
    input.BillingAddress ??
    input.billing ??
    "";
  const shippingAddress =
    input.shipping_address ??
    input.shippingAddress ??
    input.ShippingAddress ??
    input.shipping ??
    billingAddress;
  const gstin = input.gstin ?? input.GSTIN ?? input.gst ?? "";
  const pan = input.pan ?? input.PAN ?? "";
  const placeOfSupply =
    input.place_of_supply ??
    input.placeOfSupply ??
    input.PlaceOfSupply ??
    input.place ??
    "";
  const email = input.email ?? input.Email ?? "";
  const phone = input.phone ?? input.Phone ?? input.contact ?? "";
  const invoiceDate = input.invoice_date ?? input.invoiceDate ?? input.InvoiceDate ?? "";
  const dueDate = input.due_date ?? input.dueDate ?? input.DueDate ?? "";
  const notes = input.notes ?? input.Notes ?? "";
  const record = {
    uid: buildCustomerUid(invoiceNo, customerName, gstin, input.uid ?? input.id),
    invoice_no: String(invoiceNo || "").trim(),
    customer_name: String(customerName || "").trim(),
    billing_address: String(billingAddress || "").trim(),
    shipping_address: String(shippingAddress || "").trim(),
    gstin: String(gstin || "").trim(),
    pan: String(pan || "").trim(),
    place_of_supply: String(placeOfSupply || "").trim(),
    email: String(email || "").trim(),
    phone: String(phone || "").trim(),
    invoice_date: String(invoiceDate || "").trim(),
    due_date: String(dueDate || "").trim(),
    notes: String(notes || "").trim(),
  };
  if(input.meta) record.meta = input.meta;
  const createdAt = input.createdAt ?? input.created_at;
  const updatedAt = input.updatedAt ?? input.updated_at ?? createdAt;
  if(createdAt) record.createdAt = createdAt;
  if(updatedAt) record.updatedAt = updatedAt;
  return record;
}

function normalizeDraft(input = {}){
  const createdAt = input.createdAt ?? input.created_at ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? input.updated_at ?? createdAt;
  const lines = Array.isArray(input.lines)
    ? input.lines.map((line) => ({ ...line }))
    : [];
  const metaSource = input.meta;
  const meta = metaSource && typeof metaSource === "object" ? { ...metaSource } : {};
  const prefsSource = input.pdfColumnPrefs ?? input.pdf_column_prefs;
  const pdfColumnPrefs =
    prefsSource && typeof prefsSource === "object" ? { ...prefsSource } : {};
  return {
    id: input.id ?? input.uid ?? randomId("draft"),
    label: (input.label ?? input.name ?? "Draft").toString().trim() || "Draft",
    meta,
    lines,
    pdfColumnPrefs,
    createdAt,
    updatedAt,
  };
}

function fromSupabaseBook(row){
  return normalizeBook(row || {});
}

function toSupabaseBook(book){
  const normalized = normalizeBook(book || {});
  const row = {
    uid: normalized.uid,
    sku: normalized.sku || null,
    title: normalized.title || null,
    author: normalized.author || null,
    publisher: normalized.publisher || null,
    mrp: asNumber(normalized.mrp, 0),
    default_discount_pct: asNumber(normalized.default_discount_pct, 0),
    default_tax_pct: asNumber(normalized.default_tax_pct, 0),
    updated_at: normalized.updatedAt || new Date().toISOString(),
  };
  if(normalized.createdAt) row.created_at = normalized.createdAt;
  return row;
}

function fromSupabaseCustomer(row){
  return normalizeCustomer(row || {});
}

function toSupabaseCustomer(customer){
  const normalized = normalizeCustomer(customer || {});
  const row = {
    uid: normalized.uid,
    invoice_no: normalized.invoice_no || null,
    customer_name: normalized.customer_name || null,
    billing_address: normalized.billing_address || null,
    shipping_address: normalized.shipping_address || null,
    gstin: normalized.gstin || null,
    pan: normalized.pan || null,
    place_of_supply: normalized.place_of_supply || null,
    email: normalized.email || null,
    phone: normalized.phone || null,
    invoice_date: normalized.invoice_date || null,
    due_date: normalized.due_date || null,
    notes: normalized.notes || null,
    updated_at: normalized.updatedAt || new Date().toISOString(),
  };
  if(normalized.meta) row.meta = normalized.meta;
  if(normalized.createdAt) row.created_at = normalized.createdAt;
  return row;
}

function fromSupabaseDraft(row){
  return normalizeDraft({
    id: row?.uid ?? row?.id,
    label: row?.label,
    meta: row?.meta,
    lines: row?.lines,
    pdfColumnPrefs: row?.pdf_column_prefs ?? row?.pdfColumnPrefs,
    createdAt: row?.created_at,
    updatedAt: row?.updated_at,
  });
}

function toSupabaseDraft(draft){
  const normalized = normalizeDraft(draft || {});
  return {
    uid: normalized.id,
    label: normalized.label,
    meta: normalized.meta,
    lines: normalized.lines,
    pdf_column_prefs: normalized.pdfColumnPrefs,
    created_at: normalized.createdAt,
    updated_at: normalized.updatedAt || new Date().toISOString(),
  };
}

function SyncStatusPill({ status, fallback }){
  const offlineStyle = { background: "rgba(253,230,138,0.45)", color: "#92400e" };
  const loadingStyle = { background: "rgba(125,211,252,0.45)", color: "#0c4a6e" };
  const syncingStyle = { background: "rgba(147,197,253,0.45)", color: "#1d4ed8" };
  const successStyle = { background: "rgba(134,239,172,0.45)", color: "#166534" };
  const errorStyle = { background: "rgba(248,113,113,0.45)", color: "#b91c1c" };

  if(!status?.available){
    return (
      <span
        className="pill"
        style={offlineStyle}
        title="Configure Supabase environment variables to enable cloud sync."
      >
        {fallback || "Cloud sync off"}
      </span>
    );
  }
  if(status.error){
    return (
      <span className="pill" style={errorStyle} title={status.error}>
        Sync error
      </span>
    );
  }
  if(status.loading){
    return (
      <span className="pill" style={loadingStyle}>
        Loading cloud…
      </span>
    );
  }
  if(status.syncing){
    return (
      <span className="pill" style={syncingStyle}>
        Syncing…
      </span>
    );
  }
  return (
    <span className="pill" style={successStyle}>
      Cloud synced
    </span>
  );
}

function SupabaseNotice({ notice, onRetry }){
  if(!notice) return null;
  const palette = {
    info:{ background:"rgba(226,232,240,0.6)", border:"rgba(148,163,184,0.45)", color:"#0f172a" },
    warning:{ background:"rgba(253,230,138,0.55)", border:"rgba(217,119,6,0.45)", color:"#92400e" },
    error:{ background:"rgba(248,113,113,0.35)", border:"rgba(239,68,68,0.45)", color:"#b91c1c" },
    loading:{ background:"rgba(125,211,252,0.45)", border:"rgba(14,165,233,0.45)", color:"#0c4a6e" },
    success:{ background:"rgba(134,239,172,0.45)", border:"rgba(34,197,94,0.45)", color:"#166534" }
  };
  const tone = palette[notice.tone] || palette.info;
  return (
    <div
      style={{
        marginTop:16,
        padding:"12px 16px",
        borderRadius:12,
        border:`1px solid ${tone.border}`,
        background:tone.background,
        color:tone.color,
        display:"flex",
        alignItems:"center",
        justifyContent:"space-between",
        gap:12,
        flexWrap:"wrap"
      }}
      role={notice.tone === "error" ? "alert" : undefined}
    >
      <span style={{flex:"1 1 auto", minWidth:200}}>{notice.message}</span>
      {notice.canRetry && onRetry && (
        <button
          className="btn gray"
          type="button"
          onClick={onRetry}
          style={{ padding:"6px 12px", fontSize:13 }}
        >
          Retry sync
        </button>
      )}
    </div>
  );
}

function computeLine({ qty = 1, mrp = 0, rate, discountPct = 0, taxPct = 0 }) {
  const appliedRate = rate !== undefined && rate !== null && `${rate}` !== "" ? asNumber(rate) : asNumber(mrp);
  const amount = asNumber(qty) * appliedRate;
  const discountAmt = amount * (asNumber(discountPct)/100);
  const taxable = amount - discountAmt;
  const taxAmt = taxable * (asNumber(taxPct)/100);
  const net = taxable + taxAmt;
  return { appliedRate, amount, discountAmt, taxable, taxAmt, net };
}
function parseCsv(file) { return new Promise((resolve, reject) => Papa.parse(file, { header:true, skipEmptyLines:true, dynamicTyping:true, complete: r=>resolve(r.data), error: reject })); }

function renderInvoicePdf({ meta, items, totals, brand, columnOptions }) {
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const resolvedBrand = brand || BRAND_LOOKUP[DEFAULT_BRAND_KEY];
  const fonts = mergeFontStyles(resolvedBrand.fonts);
  doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.text(resolvedBrand.name, 40, 40);
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  const addressLines = doc.splitTextToSize(resolvedBrand.address, pageWidth - 80);
  doc.text(addressLines, 40, 58);
  const contactLineHeight = doc.getLineHeightFactor() * doc.getFontSize();
  const contactY = 58 + contactLineHeight * addressLines.length + 4;
  doc.text(`${resolvedBrand.phone}    ${resolvedBrand.gstin}`, 40, contactY);

  const y0=95;
  const left = [["Invoice No.", meta.invoice_no||"-"],["Invoice Date", meta.invoice_date||dayjs().format("DD-MM-YYYY")],["Due Date", meta.due_date||"-"]];
  const right = [["Place of Supply", meta.place_of_supply||"Karnataka"],["GSTIN", meta.gstin||"-"],["PAN", meta.pan||"-"]];
  autoTable(doc,{
    startY:y0, theme:"plain", styles:{
      font: fonts.subheading.family,
      fontStyle: fonts.subheading.style,
      fontSize: fonts.subheading.size,
      cellPadding:2
    }, margin:{ left:40, right:40 },
    body:[[
      {content:`Bill To\n${meta.customer_name||"-"}\n${meta.billing_address||"-"}`},
      {content:`Ship To\n${meta.shipping_address||meta.billing_address||"-"}`},
      {content:left.map(([k,v])=>`${k}: ${v}`).join("\n")+"\n"+right.map(([k,v])=>`${k}: ${v}`).join("\n")}
    ]],
    columnStyles:{0:{cellWidth:(pageWidth-80)*0.34},1:{cellWidth:(pageWidth-80)*0.33},2:{cellWidth:(pageWidth-80)*0.33}}
  });

  const startY = (doc.lastAutoTable?.finalY || y0+110) + 10;
  const prefs = columnOptions || {};
  const invoiceItems = prepareLinesForExport(items || []);
  const titlesOnly = !!prefs.titlesOnly;

  if(titlesOnly){
    const head = [["#","Title / Description"]];
    const body = invoiceItems.map((it,i)=>{
      const details = [it.title || "Untitled"];
      if(it.author) details.push(it.author);
      if(it.publisher) details.push(it.publisher);
      return [String(i+1), details.join("\n")];
    });
    const rows = body.length ? body : [["-", "No items added"]];
    autoTable(doc,{
      startY,
      head,
      body:rows,
      styles:{
        font: fonts.tableBody.family,
        fontStyle: fonts.tableBody.style,
        fontSize: fonts.tableBody.size
      },
      headStyles:{
        fillColor:[30,41,59],
        font: fonts.tableHead.family,
        fontStyle: fonts.tableHead.style,
        fontSize: fonts.tableHead.size
      },
      margin:{ left:40, right:40 },
      columnStyles:{
        0:{ cellWidth:24, halign:"center" },
        1:{ cellWidth:pageWidth-104, halign:"left" }
      }
    });
    const termsStart = (doc.lastAutoTable?.finalY || startY) + 12;
    autoTable(doc,{
      startY:termsStart,
      theme:"plain",
      margin:{ left:40, right:40 },
      styles:{
        font: fonts.terms.family,
        fontStyle: fonts.terms.style,
        fontSize: fonts.terms.size,
        halign:"center"
      },
      body:[[
        { content:(meta.notes?`Notes: ${meta.notes}\n\n`:"")+"TERMS AND CONDITIONS\n1. Goods once sold will not be taken back or exchanged\n2. All disputes are subject to Bengaluru jurisdiction only" }
      ]]
    });
    return doc;
  }

  const includeDiscount = prefs.discount ?? (totals.discount > 0.0001 || invoiceItems.some(it=>asNumber(it.discountPct||0)));
  const includeTax = prefs.tax ?? true;
  const includeAmount = prefs.amount ?? true;
  const head = [["#","Title / Description","Qty","Rate",...(includeDiscount?["Disc%"]:[]),...(includeTax?["Tax%"]:[]),...(includeAmount?["Amount"]:[]),"Net"]];
  const body = invoiceItems.map((it,i)=>{
    const r=computeLine(it);
    const row=[String(i+1), `${it.title}${it.author?`\n${it.author}`:""}${it.publisher?` • ${it.publisher}`:""}`, String(it.qty||1), formatINR(r.appliedRate)];
    if(includeDiscount) row.push(String(asNumber(it.discountPct||0)));
    if(includeTax) row.push(String(asNumber(it.taxPct||0)));
    if(includeAmount) row.push(formatINR(r.amount));
    row.push(formatINR(r.net));
    return row;
  });
  const columnStyles={0:{cellWidth:22,halign:"center"},1:{cellWidth:(pageWidth-80)*0.42},2:{halign:"center",cellWidth:34},3:{halign:"center",cellWidth:70}};
  let colIndex=4;
  if(includeDiscount){ columnStyles[colIndex]={halign:"center",cellWidth:44}; colIndex+=1; }
  if(includeTax){ columnStyles[colIndex]={halign:"center",cellWidth:44}; colIndex+=1; }
  if(includeAmount){ columnStyles[colIndex]={halign:"right",cellWidth:80}; colIndex+=1; }
  columnStyles[colIndex]={halign:"right",cellWidth:90};
  const totalStyles = (halign) => ({
    font: fonts.tableHead.family,
    fontStyle: fonts.tableHead.style,
    fontSize: fonts.tableHead.size,
    textColor:[0,0,0],
    halign
  });
  const totalsRow = [
    { content:"", styles: totalStyles("center") },
    { content:"Totals", styles: totalStyles("left") },
    { content:formatQuantity(totals.qty ?? 0), styles: totalStyles("center") },
    { content:includeAmount ? "" : formatINR(totals.taxable), styles: totalStyles("right") }
  ];
  if(includeDiscount){ totalsRow.push({ content:"", styles: totalStyles("right") }); }
  if(includeTax){ totalsRow.push({ content:formatINR(totals.tax), styles: totalStyles("right") }); }
  if(includeAmount){ totalsRow.push({ content:formatINR(totals.taxable), styles: totalStyles("right") }); }
  totalsRow.push({ content:formatINR(totals.net), styles: totalStyles("right") });
  if(body.length){
    body.push(totalsRow);
  }
  autoTable(doc,{
    startY,
    head,
    body,
    styles:{
      font: fonts.tableBody.family,
      fontStyle: fonts.tableBody.style,
      fontSize: fonts.tableBody.size
    },
    headStyles:{
      fillColor:[30,41,59],
      font: fonts.tableHead.family,
      fontStyle: fonts.tableHead.style,
      fontSize: fonts.tableHead.size
    },
    margin:{ left:40, right:40 }, columnStyles
  });

  const y1 = doc.lastAutoTable?.finalY || startY+100;
  const amountInWords = numberToIndianCurrencyWords(totals.net);
  const summaryEntries=[
    {
      label:"Total Quantity",
      value:formatQuantity(totals.qty ?? 0),
      align:"center",
      fill:[241,245,249],
      valueColor:[30,41,59],
      fontSpec:fonts.summaryValue
    },
    {
      label:"Taxable Amount",
      value:formatINR(totals.taxable),
      align:"right",
      fill:[241,245,249],
      valueColor:[15,23,42],
      fontSpec:fonts.summaryValue
    },
    {
      label:"Tax",
      value:formatINR(totals.tax),
      align:"right",
      fill:[241,245,249],
      valueColor:[15,23,42],
      fontSpec:fonts.summaryValue
    },
    {
      label:"Total Amount",
      value:formatINR(totals.net),
      align:"right",
      fill:[224,242,254],
      valueColor:[14,165,233],
      fontSpec:fonts.summaryHighlight
    }
  ];
  const summaryY = y1 + 18;
  applyFont(doc, fonts.summaryTitle);
  const summaryTitle = meta.invoice_no ? `Summary · Invoice ${meta.invoice_no}` : "Summary";
  doc.text(summaryTitle, 40, summaryY);
  const summaryLabelRow = summaryEntries.map(entry=>({
    content:entry.label,
    styles:{
      halign:"center",
      font: fonts.summaryLabel.family,
      fontStyle: fonts.summaryLabel.style,
      fontSize: fonts.summaryLabel.size,
      textColor:[71,85,105],
      fillColor:[226,232,240],
      cellPadding:{ top:6, bottom:6, left:8, right:8 }
    }
  }));
  const summaryValueRow = summaryEntries.map(entry=>({
    content:entry.value,
    styles:{
      halign:entry.align||"center",
      font:(entry.fontSpec||fonts.summaryValue).family,
      fontStyle:(entry.fontSpec||fonts.summaryValue).style,
      fontSize:(entry.fontSpec||fonts.summaryValue).size,
      textColor:entry.valueColor,
      fillColor:entry.fill,
      cellPadding:{ top:12, bottom:12, left:12, right:12 },
      lineColor:[148,163,184],
      lineWidth:0.4
    }
  }));
  autoTable(doc,{
    startY:summaryY+6,
    theme:"plain",
    margin:{ left:40, right:40 },
    styles:{ lineColor:[148,163,184], lineWidth:0.4 },
    body:[summaryLabelRow, summaryValueRow],
    columnStyles:summaryEntries.reduce((acc,_,idx)=>{
      acc[idx]={ cellWidth:(pageWidth-80)/summaryEntries.length, halign:"center" };
      return acc;
    },{})
  });
  autoTable(doc,{
    startY:(doc.lastAutoTable?.finalY||y1+60)+6,
    theme:"grid",
    margin:{ left:40, right:40 },
    styles:{
      font: fonts.amountValue.family,
      fontStyle: fonts.amountValue.style,
      fontSize: fonts.amountValue.size,
      cellPadding:{ top:10, bottom:10, left:12, right:12 },
      lineWidth:0.4,
      lineColor:[148,163,184]
    },
    body:[[
      {
        content:"Amount in Words",
        styles:{
          font: fonts.amountLabel.family,
          fontStyle: fonts.amountLabel.style,
          fontSize: fonts.amountLabel.size,
          textColor:[30,41,59],
          fillColor:[241,245,249]
        }
      },
      {
        content:amountInWords,
        styles:{
          font: fonts.amountValue.family,
          fontStyle: fonts.amountValue.style,
          fontSize: fonts.amountValue.size,
          textColor:[15,23,42]
        }
      }
    ]],
    columnStyles:{0:{cellWidth:(pageWidth-80)*0.3,halign:"left"},1:{cellWidth:(pageWidth-80)*0.7,halign:"left"}}
  });

  autoTable(doc,{
    startY:(doc.lastAutoTable?.finalY||y1+60)+8,
    theme:"plain",
    margin:{ left:40, right:40 },
    styles:{
      font: fonts.terms.family,
      fontStyle: fonts.terms.style,
      fontSize: fonts.terms.size,
      halign:"center"
    },
    body:[[ {content:(meta.notes?`Notes: ${meta.notes}\n\n`:"")+"TERMS AND CONDITIONS\n1. Goods once sold will not be taken back or exchanged\n2. All disputes are subject to Bengaluru jurisdiction only"} ]]
  });
  return doc;
}

export default function App(){
  const [tab, setTab] = usePersistentState("ui.tab", "customers"); // customers | books | invoice
  const [catalog,setCatalog]=usePersistentState("data.catalog", []);
  const [customers,setCustomers]=usePersistentState("data.customers", []);
  const [batchItems,setBatchItems]=usePersistentState("data.batchItems", []);
  const [lines,setLines]=usePersistentState("data.lines", []);
  const [editingLineIndex,setEditingLineIndex] = useState(null);
  const [savedInvoices,setSavedInvoices]=usePersistentState("data.savedInvoices", []);
  const [defaultTaxPct,setDefaultTaxPct]=usePersistentState("settings.defaultTaxPct", 0);
  const [pdfColumnPrefs,setPdfColumnPrefs]=usePersistentState("settings.pdfColumnPrefs", () => ({}));
  const [selectedBrandKey, setSelectedBrandKey] = usePersistentState(
    "settings.brandKey",
    () => DEFAULT_BRAND_KEY
  );
  const [filter,setFilter]=usePersistentState("ui.filter", "");
  const [selectedCustomer,setSelectedCustomer]=usePersistentState("ui.selectedCustomer", null);
  const [dragIndex,setDragIndex]=useState(null);
  const [dragOverIndex,setDragOverIndex]=useState(null);
  const [isBookModalOpen,setIsBookModalOpen]=useState(false);
  const [isCustomerModalOpen,setIsCustomerModalOpen]=useState(false);
  const [editingCustomer,setEditingCustomer]=useState(null);
  const [bookForm,setBookForm]=useState(()=>({ sku:"", title:"", author:"", publisher:"", mrp:"", default_discount_pct:"", default_tax_pct:"" }));
  const [customerForm,setCustomerForm]=useState(()=>({
    invoice_no:"",
    customer_name:"",
    billing_address:"",
    shipping_address:"",
    gstin:"",
    pan:"",
    place_of_supply:"",
    email:"",
    phone:"",
    invoice_date:"",
    due_date:"",
    notes:"",
  }));
  const [autoAddNewBook,setAutoAddNewBook]=useState(true);
  const [autoSelectNewCustomer,setAutoSelectNewCustomer]=useState(true);
  const [invoiceCatalogQuery,setInvoiceCatalogQuery]=useState("");
  const [draftLabel,setDraftLabel]=useState("");
  const dragIndexRef = React.useRef(null);
  const isEditingCustomer = Boolean(editingCustomer);

  useEffect(() => {
    setSelectedBrandKey((prev) => normalizeBrandKey(prev));
  }, [setSelectedBrandKey]);

  const selectedBrand = useMemo(() => {
    return BRAND_LOOKUP[selectedBrandKey] || BRAND_LOOKUP[DEFAULT_BRAND_KEY];
  }, [selectedBrandKey]);

  const closeCustomerModal = React.useCallback(()=>{
    setIsCustomerModalOpen(false);
    setEditingCustomer(null);
  },[setIsCustomerModalOpen,setEditingCustomer]);

  useEffect(()=>{
    setCatalog(prev=>{
      if(!Array.isArray(prev)) return [];
      if(prev.every(item=>item && item.uid)) return prev;
      return prev.map(normalizeBook);
    });
  },[setCatalog]);

  useEffect(()=>{
    setCustomers(prev=>{
      if(!Array.isArray(prev)) return [];
      if(prev.every(item=>item && item.uid)) return prev;
      return prev.map(normalizeCustomer);
    });
  },[setCustomers]);

  useEffect(()=>{
    setSavedInvoices(prev=>{
      if(!Array.isArray(prev)) return [];
      if(prev.every(item=>item && item.id)) return prev;
      return prev.map(normalizeDraft);
    });
  },[setSavedInvoices]);

  useEffect(()=>{
    setLines(prev=>normalizeInvoiceLines(prev));
  },[setLines]);

  useEffect(()=>{
    if(!selectedCustomer) return;
    if(selectedCustomer.uid) return;
    setSelectedCustomer(normalizeCustomer(selectedCustomer));
  },[selectedCustomer,setSelectedCustomer]);

  useEffect(()=>{
    if(!selectedCustomer) return;
    const match=customers.find(c=>c.uid===selectedCustomer.uid);
    if(match && match!==selectedCustomer){
      setSelectedCustomer(match);
    }
  },[customers,selectedCustomer,setSelectedCustomer]);

  const bookSyncStatus = useSupabaseSync({
    table:"books",
    state:catalog,
    setState:setCatalog,
    identity:bookIdentity,
    fromRow:fromSupabaseBook,
    toRow:toSupabaseBook,
    conflictTarget:"workspace_id,uid",
    orderBy:BOOK_ORDER_BY
  });

  const customerSyncStatus = useSupabaseSync({
    table:"customers",
    state:customers,
    setState:setCustomers,
    identity:customerIdentity,
    fromRow:fromSupabaseCustomer,
    toRow:toSupabaseCustomer,
    conflictTarget:"workspace_id,uid",
    orderBy:CUSTOMER_ORDER_BY
  });

  const draftSyncStatus = useSupabaseSync({
    table:"draft_invoices",
    state:savedInvoices,
    setState:setSavedInvoices,
    identity:draftIdentity,
    fromRow:fromSupabaseDraft,
    toRow:toSupabaseDraft,
    conflictTarget:"workspace_id,uid",
    orderBy:DRAFT_ORDER_BY
  });

  const { refresh:refreshBooks } = bookSyncStatus;
  const { refresh:refreshCustomers } = customerSyncStatus;
  const { refresh:refreshDrafts } = draftSyncStatus;

  const retrySupabaseSync = React.useCallback(()=>{
    const retryFns = [refreshBooks, refreshCustomers, refreshDrafts];
    retryFns.forEach((fn)=>{
      if(typeof fn === "function"){
        try{
          fn();
        }catch(error){
          console.error("Supabase retry failed", error);
        }
      }
    });
  },[refreshBooks,refreshCustomers,refreshDrafts]);

  const supabaseStatuses=[bookSyncStatus,customerSyncStatus,draftSyncStatus];
  const availableStatuses=supabaseStatuses.filter(status=>status?.available);
  const errorStatus=availableStatuses.find(status=>status?.error);
  const loadingStatus=availableStatuses.find(status=>status?.loading);
  const syncingStatus=availableStatuses.find(status=>status?.syncing);

  let supabaseNotice=null;
  if(!isSupabaseConfigured || !availableStatuses.length){
    if(supabaseUrlError){
      supabaseNotice={
        tone:"warning",
        message:supabaseUrlError,
        canRetry:false
      };
    }else{
      supabaseNotice={
        tone:"info",
        message:
          "Cloud sync is currently disabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Supabase backups.",
        canRetry:false
      };
    }
  }else if(errorStatus){
    supabaseNotice={
      tone:"error",
      message:`Supabase request failed: ${errorStatus.error}`,
      canRetry:true
    };
  }else if(loadingStatus){
    supabaseNotice={
      tone:"loading",
      message:"Connecting to Supabase…",
      canRetry:false
    };
  }else if(syncingStatus){
    supabaseNotice={
      tone:"loading",
      message:"Syncing changes with Supabase…",
      canRetry:false
    };
  }else{
    supabaseNotice={
      tone:"success",
      message:`Supabase connection established for workspace “${supabaseWorkspaceId}”. Tables start empty until you add data.`,
      canRetry:false
    };
  }

  useEffect(()=>{
    if(!isBookModalOpen) return;
    const handler=(event)=>{
      if(event.key==='Escape') setIsBookModalOpen(false);
    };
    window.addEventListener('keydown', handler);
    return ()=>window.removeEventListener('keydown', handler);
  },[isBookModalOpen]);

  useEffect(()=>{
    if(!isCustomerModalOpen) return;
    const handler=(event)=>{
      if(event.key==='Escape') closeCustomerModal();
    };
    window.addEventListener('keydown', handler);
    return ()=>window.removeEventListener('keydown', handler);
  },[isCustomerModalOpen,closeCustomerModal]);

  const filteredBooks = useMemo(()=>{ const q=filter.trim().toLowerCase(); if(!q) return catalog; return catalog.filter(b=>[b.sku,b.title,b.author,b.publisher].filter(Boolean).some(f=>String(f).toLowerCase().includes(q))); },[filter,catalog]);
  const trimmedInvoiceQuery = invoiceCatalogQuery.trim();
  const invoiceCatalogMatches = useMemo(()=>{
    const query = trimmedInvoiceQuery.toLowerCase();
    if(query.length < 2) return [];
    return catalog
      .filter((b)=>[b.sku,b.title,b.author,b.publisher]
        .filter(Boolean)
        .some((field)=>String(field).toLowerCase().includes(query)))
      .slice(0, 12);
  },[trimmedInvoiceQuery,catalog]);
  const canSearchCatalog = trimmedInvoiceQuery.length >= 2;

  function addLine(b){
    const fallbackTax = defaultTaxPct ?? 0;
    const taxValue = b.default_tax_pct !== undefined ? b.default_tax_pct : fallbackTax;
    setLines(prev=>{
      const list=Array.isArray(prev)?prev:[];
      const order=nextInvoiceLineOrder(list);
      return [
        ...list,
        {
          sku:b.sku,
          title:b.title,
          author:b.author,
          publisher:b.publisher,
          qty:1,
          mrp:asNumber(b.mrp),
          rate:"",
          discountPct:asNumber(b.default_discount_pct||0),
          taxPct:asNumber(taxValue),
          order,
        }
      ];
    });
  }
  function addAllBooks(list){
    if(!list.length) return;
    setLines(prev=>{
      const existingKeys = new Set(prev.map(l=>`${l.sku||""}__${l.title||""}`));
      const additions = [];
      let nextOrder = nextInvoiceLineOrder(prev);
      for(const b of list){
        const key = `${b.sku||""}__${b.title||""}`;
        if(existingKeys.has(key)) continue;
        existingKeys.add(key);
        const fallbackTax = defaultTaxPct ?? 0;
        const taxValue = b.default_tax_pct !== undefined ? b.default_tax_pct : fallbackTax;
        additions.push({
          sku:b.sku,
          title:b.title,
          author:b.author,
          publisher:b.publisher,
          qty:1,
          mrp:asNumber(b.mrp),
          rate:"",
          discountPct:asNumber(b.default_discount_pct||0),
          taxPct:asNumber(taxValue),
          order: nextOrder++,
        });
      }
      if(!additions.length) return prev;
      return [...prev, ...additions];
    });
  }
  function applyDefaultTax(){
    const tax = asNumber(defaultTaxPct??0,0);
    setLines(p=>p.map(l=>({ ...l, taxPct:tax })));
  }
  function updateLine(i,patch){ setLines(p=>p.map((l,idx)=>idx===i?{...l,...patch}:l)); }
  function clearInvoiceLines(){
    setLines([]);
    setEditingLineIndex(null);
  }
  function reorderLines(from,to){
    if(from===null || to===null || from===to) return;
    setLines(prev=>{
      if(from<0 || from>=prev.length || to<0 || to>=prev.length) return prev;
      const next=[...prev];
      const [moved]=next.splice(from,1);
      next.splice(to,0,moved);
      return next;
    });
    setEditingLineIndex(prev=>{
      if(prev===null) return prev;
      if(prev===from) return to;
      if(from<prev && prev<=to) return prev-1;
      if(to<=prev && prev<from) return prev+1;
      return prev;
    });
  }
  function handleDragStart(index){
    dragIndexRef.current=index;
    setDragIndex(index);
    setDragOverIndex(index);
  }
  function handleDragEnter(index){
    if(index===dragOverIndex || index===dragIndexRef.current) return;
    setDragOverIndex(index);
  }
  function handleDragEnd(){
    dragIndexRef.current=null;
    setDragIndex(null);
    setDragOverIndex(null);
  }
  function handleDrop(index,{ after=false }={}){
    const from=dragIndexRef.current;
    const total=lines.length;
    if(from===null || total<=1){
      handleDragEnd();
      return;
    }
    let target=index;
    if(after){
      target = from<index ? index : index+1;
    }else{
      target = from<index ? index-1 : index;
    }
    target=Math.max(0, Math.min(target, total-1));
    handleDragEnd();
    reorderLines(from,target);
  }
  function applyOrderNumbers(){
    setLines(prev=>{
      const sorted=sortLinesByOrderValue(prev);
      const lengthDiffers=sorted.length!==prev.length;
      if(lengthDiffers){
        return normalizeInvoiceLines(sorted.map(line=>({ ...line })));
      }
      for(let i=0;i<sorted.length;i+=1){
        if(sorted[i]!==prev[i]){
          return normalizeInvoiceLines(sorted.map(line=>({ ...line })));
        }
      }
      return normalizeInvoiceLines(prev);
    });
    setEditingLineIndex(null);
  }
  function removeLine(i){
    setLines(p=>p.filter((_,idx)=>idx!==i));
    setEditingLineIndex(prev=>{
      if(prev===null) return prev;
      if(prev===i) return null;
      if(prev>i) return prev-1;
      return prev;
    });
  }

  const totals = useMemo(()=>lines.reduce((a,it)=>{ const r=computeLine(it); a.amount+=r.amount; a.discount+=r.discountAmt; a.taxable+=r.taxable; a.tax+=r.taxAmt; a.net+=r.net; a.qty+=asNumber(it.qty||0,0); return a; },{ amount:0, discount:0, taxable:0, tax:0, net:0, qty:0 }),[lines]);
  const amountInWords = useMemo(()=>numberToIndianCurrencyWords(totals.net),[totals.net]);
  const autoDiscountColumn = useMemo(()=>totals.discount > 0.0001 || lines.some(it=>asNumber(it.discountPct||0)),[totals.discount,lines]);
  const pdfColumns = useMemo(()=>{
    const titlesOnly = !!(pdfColumnPrefs.titlesOnly ?? false);
    const discount = pdfColumnPrefs.discount ?? autoDiscountColumn;
    const tax = pdfColumnPrefs.tax ?? true;
    const amount = pdfColumnPrefs.amount ?? true;
    return {
      titlesOnly,
      discount: titlesOnly ? false : discount,
      tax: titlesOnly ? false : tax,
      amount: titlesOnly ? false : amount,
    };
  },[pdfColumnPrefs,autoDiscountColumn]);
  const hasCustomPdfColumns = useMemo(()=>Object.keys(pdfColumnPrefs).length>0,[pdfColumnPrefs]);

  const togglePdfColumn = (key) => {
    setPdfColumnPrefs(prev=>{
      if(key === "titlesOnly"){
        const nextValue = !prev?.titlesOnly;
        if(nextValue){
          return { ...prev, titlesOnly: true };
        }
        const { titlesOnly, ...rest } = prev || {};
        return rest;
      }
      return { ...prev, [key]: !pdfColumns[key] };
    });
  };
  const resetPdfColumns = () => setPdfColumnPrefs({});

  const cloudStatusLabel = useMemo(()=>{
    const statuses=[bookSyncStatus,customerSyncStatus,draftSyncStatus];
    if(!statuses.some(status=>status?.available)) return "Local-only";
    if(statuses.some(status=>status?.error)) return "Sync error";
    if(statuses.some(status=>status?.loading)) return "Connecting";
    if(statuses.some(status=>status?.syncing)) return "Syncing";
    return "Supabase";
  },[bookSyncStatus,customerSyncStatus,draftSyncStatus]);

  const statEntries = useMemo(()=>[
    { label:"Customers Loaded", value: customers.length },
    { label:"Books Catalogued", value: catalog.length },
    { label:"Visible Books", value: filteredBooks.length },
    { label:"Invoice Lines", value: lines.length },
    { label:"Current Invoice Net", value: formatINR(totals.net) },
    { label:"Cloud Sync", value: cloudStatusLabel }
  ],[customers.length,catalog.length,filteredBooks.length,lines.length,totals.net,cloudStatusLabel]);

  async function onLoadCatalog(e){
    const file=e.target.files?.[0];
    if(!file) return;
    const rows=await parseCsv(file);
    const normalized=rows
      .map((row)=>normalizeBook(row))
      .filter((entry)=>entry.title || entry.sku);
    setCatalog(normalized);
  }
  async function onLoadCustomers(e){
    const file=e.target.files?.[0];
    if(!file) return;
    const rows=await parseCsv(file);
    const normalized=rows
      .map((row)=>normalizeCustomer(row))
      .filter((entry)=>entry.invoice_no || entry.customer_name);
    setCustomers(normalized);
  }
  async function onLoadItems(e){ const f=e.target.files?.[0]; if(!f) return; const rows=await parseCsv(f); setBatchItems(rows); }

  function pickCustomer(inv){ const c=customers.find(r=>String(r.invoice_no)===String(inv)); if(c) setSelectedCustomer(c); }

  function currentInvoiceMeta(){
    return selectedCustomer||{
      invoice_no:"DRAFT-001",
      invoice_date:dayjs().format("DD-MM-YYYY"),
      due_date:dayjs().format("DD-MM-YYYY"),
      customer_name:"Walk-in Customer",
      billing_address:"",
      shipping_address:"",
      gstin:"",
      pan:"",
      place_of_supply:"Karnataka",
      notes:""
    };
  }

  async function generateSingle(){
    const meta={ ...currentInvoiceMeta(), brandKey: selectedBrandKey };
    const orderedLines=prepareLinesForExport(lines);
    const doc=renderInvoicePdf({ meta, items:orderedLines, totals, columnOptions:pdfColumnPrefs, brand:selectedBrand });
    doc.save(`${meta.invoice_no||"invoice"}.pdf`);
    await persistInvoiceRecord({
      invoiceNo: meta.invoice_no,
      customerName: meta.customer_name,
      meta,
      items: orderedLines,
      totals,
      pdfColumnPrefs,
      source: "single",
    });
  }

  function openAddBookModal(){
    setBookForm({ sku:"", title:"", author:"", publisher:"", mrp:"", default_discount_pct:"", default_tax_pct:"" });
    setAutoAddNewBook(true);
    setIsBookModalOpen(true);
  }

  function openAddCustomerModal(){
    setEditingCustomer(null);
    setCustomerForm({
      invoice_no:"",
      customer_name:"",
      billing_address:"",
      shipping_address:"",
      gstin:"",
      pan:"",
      place_of_supply:"",
      email:"",
      phone:"",
      invoice_date:"",
      due_date:"",
      notes:"",
    });
    setAutoSelectNewCustomer(true);
    setIsCustomerModalOpen(true);
  }

  function openEditCustomerModal(customer){
    const normalized = normalizeCustomer(customer || {});
    setCustomerForm({
      invoice_no: normalized.invoice_no || "",
      customer_name: normalized.customer_name || "",
      billing_address: normalized.billing_address || "",
      shipping_address: normalized.shipping_address || "",
      gstin: normalized.gstin || "",
      pan: normalized.pan || "",
      place_of_supply: normalized.place_of_supply || "",
      email: normalized.email || "",
      phone: normalized.phone || "",
      invoice_date: normalized.invoice_date || "",
      due_date: normalized.due_date || "",
      notes: normalized.notes || "",
    });
    setAutoSelectNewCustomer(selectedCustomer?.uid === normalized.uid);
    setEditingCustomer(normalized);
    setIsCustomerModalOpen(true);
  }

  function upsertBook(book){
    const normalized=normalizeBook(book);
    setCatalog(prev=>{
      const existing=Array.isArray(prev)?prev.slice():[];
      const mapped=existing.map(normalizeBook);
      const idx=mapped.findIndex(item=>item.uid===normalized.uid);
      if(idx>=0){
        const current=mapped[idx];
        mapped[idx]={ ...current, ...normalized, uid: current.uid };
      }else{
        mapped.push(normalized);
      }
      return mapped;
    });
  }

  function upsertCustomer(customer){
    const normalized = normalizeCustomer(customer);
    setCustomers(prev=>{
      const existing = Array.isArray(prev) ? prev.slice() : [];
      const mapped = existing.map(normalizeCustomer);
      const idx = mapped.findIndex((item)=>item.uid===normalized.uid);
      if(idx>=0){
        const current = mapped[idx];
        mapped[idx] = { ...current, ...normalized, uid: current.uid };
      }else{
        mapped.push(normalized);
      }
      return mapped;
    });
    return normalized;
  }

  function submitBookForm(e){
    e.preventDefault();
    const title=bookForm.title?.trim();
    if(!title){ alert("Please enter a book title."); return; }
    const newBook={
      sku:bookForm.sku?.trim()||"",
      title,
      author:bookForm.author?.trim()||"",
      publisher:bookForm.publisher?.trim()||"",
      mrp:asNumber(bookForm.mrp,0),
      default_discount_pct:asNumber(bookForm.default_discount_pct,0),
      default_tax_pct:bookForm.default_tax_pct!==""?asNumber(bookForm.default_tax_pct,0):(defaultTaxPct??0)
    };
    upsertBook(newBook);
    if(autoAddNewBook){
      addLine(newBook);
    }
    setIsBookModalOpen(false);
  }

  function submitCustomerForm(e){
    e.preventDefault();
    const invoiceNo = customerForm.invoice_no?.trim();
    const customerName = customerForm.customer_name?.trim();
    if(!invoiceNo){ alert("Please enter an invoice number."); return; }
    if(!customerName){ alert("Please enter a customer name."); return; }
    const payload = {
      invoice_no: invoiceNo,
      customer_name: customerName,
      billing_address: customerForm.billing_address?.trim() || "",
      shipping_address:
        customerForm.shipping_address?.trim() || customerForm.billing_address?.trim() || "",
      gstin: customerForm.gstin?.trim() || "",
      pan: customerForm.pan?.trim() || "",
      place_of_supply: customerForm.place_of_supply?.trim() || "",
      email: customerForm.email?.trim() || "",
      phone: customerForm.phone?.trim() || "",
      invoice_date: customerForm.invoice_date?.trim() || "",
      due_date: customerForm.due_date?.trim() || "",
      notes: customerForm.notes?.trim() || "",
    };
    if(editingCustomer?.uid){
      payload.uid = editingCustomer.uid;
      if(editingCustomer.createdAt) payload.createdAt = editingCustomer.createdAt;
      if(editingCustomer.meta) payload.meta = editingCustomer.meta;
    }
    const normalized = upsertCustomer(payload);
    if(editingCustomer){
      if(selectedCustomer?.uid === editingCustomer.uid){
        setSelectedCustomer(normalized);
      }
    }else if(autoSelectNewCustomer){
      setSelectedCustomer(normalized);
      setTab("invoice");
    }
    closeCustomerModal();
  }

  function startNewInvoice(){
    setLines([]);
    setSelectedCustomer(null);
    setDraftLabel("");
    setEditingLineIndex(null);
    setInvoiceCatalogQuery("");
    setTab("invoice");
  }

  function saveCurrentDraft(){
    if(!lines.length){ alert("Add at least one line item before saving a draft."); return; }
    const meta=currentInvoiceMeta();
    const label=(draftLabel||meta.invoice_no||"Draft").trim();
    const timestamp=new Date().toISOString();
    const normalizedLines=normalizeInvoiceLines(lines);
    const linesCopy=sortLinesByOrderValue(normalizedLines).map((line)=>({ ...line }));
    const pdfPrefsCopy={ ...pdfColumnPrefs };
    const metaCopy={ ...meta, brandKey: selectedBrandKey };
    setSavedInvoices(prev=>{
      const drafts=Array.isArray(prev)?prev.map(normalizeDraft):[];
      const existingIndex=drafts.findIndex(d=>d.label.toLowerCase()===label.toLowerCase());
      const createdAt=existingIndex>=0?drafts[existingIndex].createdAt:timestamp;
      const identifier=existingIndex>=0?drafts[existingIndex].id:undefined;
      const payload=normalizeDraft({
        id:identifier,
        label,
        meta:metaCopy,
        lines:linesCopy,
        pdfColumnPrefs:pdfPrefsCopy,
        createdAt,
        updatedAt:timestamp
      });
      if(existingIndex>=0){
        drafts[existingIndex]=payload;
      }else{
        drafts.push(payload);
      }
      drafts.sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
      return drafts;
    });
    setDraftLabel(label||"Draft");
  }

  function loadDraft(draft){
    if(!draft) return;
    setLines(prev=>{
      const cloned=draft.lines?.map(l=>({ ...l }))||[];
      return normalizeInvoiceLines(cloned);
    });
    setEditingLineIndex(null);
    setPdfColumnPrefs(draft.pdfColumnPrefs||{});
    setSelectedCustomer(draft.meta ? normalizeCustomer(draft.meta) : null);
    if(draft?.meta?.brandKey){
      setSelectedBrandKey(normalizeBrandKey(draft.meta.brandKey));
    }
    setDraftLabel(draft.label||"");
    setTab('invoice');
  }

  function deleteDraft(identifier){ setSavedInvoices(prev=>prev.filter(d=>(d.id??d.label)!==(identifier??""))); }

  async function generateBatch(){
    if(!customers.length){ alert("Load customers.csv first"); return; }
    const zip=new JSZip();
    for(const cust of customers){
      const invNo=cust.invoice_no;
      const perItems=(batchItems.length?batchItems:lines)
        .filter(li=>batchItems.length?String(li.invoice_no)===String(invNo):true)
        .map(li=>{
          const match=catalog.find(b=>String(b.sku)===String(li.sku_or_title)||String(b.title).toLowerCase()===String(li.sku_or_title).toLowerCase());
          const title=match?.title||li.sku_or_title||li.title||"Item";
          const taxSource = li.tax_pct_override??match?.default_tax_pct??defaultTaxPct??0;
          const rawOrder =
            li.order ??
            li.Order ??
            li.serial ??
            li.Serial ??
            li.serial_no ??
            li.serialNo ??
            li.SerialNo ??
            li.serial_number ??
            li.SerialNumber ??
            li.sequence ??
            li.Sequence ??
            null;
          const parsedOrder = parseOrderValue(rawOrder);
          return {
            title,
            author:match?.author||li.author||"",
            publisher:match?.publisher||li.publisher||"",
            qty:asNumber(li.qty||1),
            mrp:asNumber(li.mrp??match?.mrp??li.rate_override??0),
            rate:li.rate_override??"",
            discountPct:asNumber(li.discount_pct_override??match?.default_discount_pct??0),
            taxPct:asNumber(taxSource),
            order: parsedOrder ?? undefined
          };
        });
      const used = perItems.length?perItems:lines;
      const totals=used.reduce((a,it)=>{ const r=computeLine(it); a.amount+=r.amount; a.discount+=r.discountAmt; a.taxable+=r.taxable; a.tax+=r.taxAmt; a.net+=r.net; a.qty+=asNumber(it.qty||0,0); return a; },{ amount:0, discount:0, taxable:0, tax:0, net:0, qty:0 });
      const orderedUsed=prepareLinesForExport(used);
      const meta = { ...cust, brandKey: selectedBrandKey };
      const doc=renderInvoicePdf({ meta, items:orderedUsed, totals, columnOptions:pdfColumnPrefs, brand:selectedBrand });
      const blob=doc.output("blob");
      zip.file(`${invNo||"invoice"}.pdf`, blob);
      await persistInvoiceRecord({
        invoiceNo: cust.invoice_no,
        customerName: cust.customer_name,
        meta,
        items: orderedUsed,
        totals,
        pdfColumnPrefs,
        source: "batch",
      });
    }
    const out=await zip.generateAsync({ type:"blob" });
    saveAs(out, `invoices_${dayjs().format("YYYYMMDD_HHmm")}.zip`);
  }

  return (
    <div className="app-shell">
      <div className="hero">
        <div className="hero-content">
          <div className="hero-eyebrow">Garani Publication Toolkit</div>
          <h1>Bulk Invoice Generator</h1>
          <p>
            Upload your catalog and customer rosters, fine-tune invoice lines, and export polished billing PDFs in a few vibrant clicks.
          </p>
          <div className="stats-grid">
            {statEntries.map((stat,idx)=>(
              <div key={idx} className="stat-card">
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
          <SupabaseNotice
            notice={supabaseNotice}
            onRetry={supabaseNotice?.canRetry ? retrySupabaseSync : undefined}
          />
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button className={"tab "+(tab==='customers'?'active':'')} onClick={()=>setTab('customers')} role="tab" aria-selected={tab==='customers'}>Customers</button>
        <button className={"tab "+(tab==='books'?'active':'')} onClick={()=>setTab('books')} role="tab" aria-selected={tab==='books'}>Books</button>
        <button className={"tab "+(tab==='invoice'?'active':'')} onClick={()=>setTab('invoice')} role="tab" aria-selected={tab==='invoice'}>Invoice</button>
      </div>

      <div className="card">
        {tab==='customers' && (
          <div>
            <div className="section-header">
              <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <h2 style={{margin:0}}>Customers</h2>
                <button
                  className="btn"
                  style={{background:'linear-gradient(135deg, #38bdf8, #0ea5e9)', color:'#fff'}}
                  onClick={openAddCustomerModal}
                >
                  Add Customer Manually
                </button>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span className="pill">{customers.length ? `${customers.length} customers loaded` : 'Awaiting CSV upload'}</span>
                <SyncStatusPill status={customerSyncStatus} fallback="Cloud sync off" />
              </div>
            </div>
            <p style={{color:'#475569', marginTop:0}}>Load customers and then switch to Invoice tab to preview or batch-generate colourful PDFs.</p>
            <div style={{display:'flex', flexWrap:'wrap', gap:12, alignItems:'center'}}>
              <input type="file" accept=".csv" onChange={onLoadCustomers} />
              <span style={{fontSize:12, color:'#64748b'}}>You can also add one-off customers manually.</span>
            </div>
            <div style={{maxHeight:360, overflow:'auto', marginTop:16}}>
              <table>
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Name</th>
                    <th>Billing</th>
                    <th>Shipping</th>
                    <th>GSTIN</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c,i)=>(
                    <tr key={i}>
                      <td>{c.invoice_no}</td>
                      <td>{c.customer_name}</td>
                      <td>{c.billing_address}</td>
                      <td>{c.shipping_address}</td>
                      <td>{c.gstin||'-'}</td>
                      <td style={{textAlign:'right'}}>
                        <button className="btn gray" type="button" onClick={()=>openEditCustomerModal(c)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                  {!customers.length && (
                    <tr>
                      <td colSpan="6" style={{color:'#64748b', textAlign:'center'}}>No customers loaded</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='books' && (
          <div>
            <div className="section-header">
              <h2>Books Catalog</h2>
              <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span className="pill">{filteredBooks.length} matching titles</span>
                <SyncStatusPill status={bookSyncStatus} fallback="Cloud sync off" />
              </div>
            </div>
            <input type="file" accept=".csv" onChange={onLoadCatalog} />
            <div style={{marginTop:8}}>
              <input className="input" placeholder="Search title/author/publisher" value={filter} onChange={e=>setFilter(e.target.value)} />
              <div style={{marginTop:8, display:'flex', justifyContent:'flex-end', gap:8}}>
                <button className="btn" style={{background:'linear-gradient(135deg, #f472b6, #ec4899)', color:'#fff'}} onClick={openAddBookModal}>Add Book Manually</button>
                <button className="btn gray" onClick={()=>addAllBooks(filteredBooks)}>Add All Filtered</button>
              </div>
            </div>
            <div style={{maxHeight:360, overflow:'auto', marginTop:16}}>
              <table>
                <thead><tr><th>SKU</th><th>Title</th><th>Author</th><th>Publisher</th><th>MRP</th><th>Default Disc%</th><th>Add</th></tr></thead>
                <tbody>
                  {filteredBooks.map((b,i)=>(<tr key={i}><td>{b.sku}</td><td>{b.title}</td><td>{b.author}</td><td>{b.publisher}</td><td>{formatINR(b.mrp)}</td><td>{b.default_discount_pct||0}</td><td><button className="btn sky" onClick={()=>addLine(b)}>Add</button></td></tr>))}
                  {!filteredBooks.length && <tr><td colSpan="7" style={{color:'#64748b', textAlign:'center'}}>No books match your search yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='invoice' && (
          <div>
            <div className="section-header">
              <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <h2 style={{margin:0}}>Invoice Builder</h2>
                <button className="btn" style={{background:'linear-gradient(135deg,#f97316,#fb923c)', color:'#fff'}} onClick={startNewInvoice}>New Invoice</button>
              </div>
              <span className="pill">{lines.length ? `${lines.length} line items ready` : 'Add titles from the catalog'}</span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:16}}>
              <div>
                <label>Select publication header</label>
                <select
                  className="input"
                  value={selectedBrandKey}
                  onChange={(e)=>setSelectedBrandKey(normalizeBrandKey(e.target.value))}
                >
                  {BRAND_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <div style={{marginTop:8, fontSize:12, color:'#475569', lineHeight:1.5}}>
                  {selectedBrand.address.split("\n").map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                  <div>{selectedBrand.phone}</div>
                  <div>{selectedBrand.gstin}</div>
                </div>
              </div>
              <div>
                <label>Pick customer by invoice no.</label>
                <input className="input" placeholder="Type invoice_no" onChange={(e)=>pickCustomer(e.target.value)} />
                <button className="btn dark" style={{marginTop:12, width:'100%'}} onClick={generateSingle}>Generate Single PDF</button>
              </div>
              <div>
                <label>Optional line items CSV (for batch)</label>
                <input type="file" accept=".csv" onChange={onLoadItems} />
              </div>
              <div>
                <label>Batch output</label>
                <button className="btn green" style={{display:'block', width:'100%', marginTop:12}} onClick={generateBatch}>Generate ZIP of PDFs</button>
              </div>
            </div>
            <div style={{marginTop:24, padding:'16px', background:'#f8fafc', borderRadius:12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <h3 style={{margin:0, fontSize:16, color:'#0f172a'}}>Add catalog titles</h3>
                {canSearchCatalog && invoiceCatalogMatches.length>0 && (
                  <span className="pill">{invoiceCatalogMatches.length} matches</span>
                )}
              </div>
              <p style={{color:'#475569', fontSize:12, marginTop:8, marginBottom:12}}>Search your catalog without leaving the invoice builder. Select a title to add it as a new line.</p>
              <input
                className="input"
                value={invoiceCatalogQuery}
                onChange={(e)=>setInvoiceCatalogQuery(e.target.value)}
                placeholder={catalog.length ? 'Search by title, author, publisher, or SKU' : 'Load the catalog to start searching'}
                disabled={!catalog.length}
              />
              {canSearchCatalog ? (
                <div style={{marginTop:12, maxHeight:220, overflow:'auto', border:'1px solid rgba(148,163,184,0.35)', borderRadius:12}}>
                  {invoiceCatalogMatches.length ? (
                    <ul style={{listStyle:'none', margin:0, padding:0}}>
                      {invoiceCatalogMatches.map((book)=> (
                        <li key={book.uid} style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'10px 14px', borderBottom:'1px solid rgba(148,163,184,0.25)'}}>
                          <div style={{flex:'1 1 auto', minWidth:0}}>
                            <div style={{fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{book.title || 'Untitled'}</div>
                            <div style={{fontSize:12, color:'#64748b', display:'flex', flexWrap:'wrap', gap:6}}>
                              {book.author && <span>{book.author}</span>}
                              {book.publisher && <span>{book.publisher}</span>}
                              {book.sku && <span style={{fontVariantNumeric:'tabular-nums'}}>SKU: {book.sku}</span>}
                            </div>
                          </div>
                          <button className="btn sky" type="button" onClick={()=>addLine(book)}>Add</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{padding:'12px 14px', color:'#64748b', fontSize:13}}>No catalog titles match “{trimmedInvoiceQuery}”.</div>
                  )}
                </div>
              ) : (
                <div style={{marginTop:12, color:'#64748b', fontSize:12}}>Type at least two characters to see matching catalog titles.</div>
              )}
            </div>
            <div style={{marginTop:24, padding:'16px', background:'#f8fafc', borderRadius:12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                <h3 style={{margin:0, fontSize:16, color:'#0f172a'}}>PDF Columns</h3>
                {hasCustomPdfColumns && (
                  <button className="btn gray" style={{padding:'6px 12px', fontSize:12}} onClick={resetPdfColumns}>Reset to defaults</button>
                )}
              </div>
              <p style={{color:'#475569', fontSize:12, marginTop:0, marginBottom:12}}>Pick which columns should appear when you export the invoice PDF.</p>
              <div style={{display:'flex', flexWrap:'wrap', gap:16}}>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.titlesOnly} onChange={()=>togglePdfColumn('titlesOnly')} />
                  <span>Titles only (hide quantities &amp; pricing)</span>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.discount} onChange={()=>togglePdfColumn('discount')} disabled={pdfColumns.titlesOnly} />
                  <span>Discount %</span>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.tax} onChange={()=>togglePdfColumn('tax')} disabled={pdfColumns.titlesOnly} />
                  <span>Tax %</span>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.amount} onChange={()=>togglePdfColumn('amount')} disabled={pdfColumns.titlesOnly} />
                  <span>Amount</span>
                </label>
                <span style={{fontSize:12, color:'#64748b'}}>Net column is always included unless titles only mode is selected.</span>
              </div>
              {pdfColumns.titlesOnly && (
                <p style={{marginTop:12, fontSize:12, color:'#475569'}}>
                  Titles-only mode exports a simplified PDF listing just the book titles.
                  Quantity and pricing details are omitted.
                </p>
              )}
            </div>
            <div style={{marginTop:24, padding:'16px', background:'#f1f5f9', borderRadius:12}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <h3 style={{marginTop:0, fontSize:16, color:'#0f172a'}}>Invoice Drafts</h3>
                <SyncStatusPill status={draftSyncStatus} fallback="Cloud sync off" />
              </div>
              <p style={{color:'#475569', fontSize:12, marginTop:0}}>
                Save your current invoice so you can pause mid-way and resume later.
                {draftSyncStatus.available
                  ? ' Drafts sync to your Supabase workspace whenever changes are saved.'
                  : ' Drafts stay in your browser storage until Supabase sync is configured.'}
              </p>
              <div style={{display:'flex', flexWrap:'wrap', gap:12}}>
                <div style={{flex:'1 1 220px', minWidth:220}}>
                  <label style={{marginBottom:6}}>Draft name</label>
                  <input className="input" value={draftLabel} onChange={e=>setDraftLabel(e.target.value)} placeholder="e.g. Invoice 1024" />
                </div>
                <div style={{display:'flex', alignItems:'flex-end'}}>
                  <button className="btn sky" style={{padding:'10px 16px'}} onClick={saveCurrentDraft}>Save Draft</button>
                </div>
              </div>
              <div style={{marginTop:16, maxHeight:200, overflow:'auto', borderRadius:12, border:'1px solid rgba(148,163,184,0.35)'}}>
                <table style={{margin:0}}>
                  <thead><tr><th style={{width:'40%'}}>Draft</th><th>Updated</th><th style={{width:140}}>Actions</th></tr></thead>
                  <tbody>
                    {savedInvoices.length?savedInvoices.map((draft)=>(
                      <tr key={draft.id||draft.label}>
                        <td>
                          <div style={{fontWeight:600}}>{draft.label}</div>
                          <div style={{fontSize:12, color:'#64748b'}}>Lines: {draft.lines?.length||0}</div>
                        </td>
                        <td style={{fontSize:12, color:'#475569'}}>{dayjs(draft.updatedAt).format('DD MMM YYYY, HH:mm')}</td>
                        <td style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                          <button className="btn sky" style={{flex:'1 1 auto'}} onClick={()=>loadDraft(draft)}>Load</button>
                          <button className="btn gray" style={{flex:'1 1 auto'}} onClick={()=>deleteDraft(draft.id??draft.label)}>Delete</button>
                        </td>
                      </tr>
                    )):(
                      <tr><td colSpan="3" style={{textAlign:'center', color:'#64748b'}}>No drafts saved yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p style={{color:'#475569', fontSize:12, marginTop:16}}>Drag the order column handle to arrange invoice lines before exporting.</p>
            <div style={{display:'flex', justifyContent:'flex-end', gap:8, flexWrap:'wrap'}}>
              <button className="btn gray" onClick={applyDefaultTax} type="button">Apply default tax to all</button>
              <button className="btn gray" onClick={clearInvoiceLines} type="button" disabled={!lines.length}>Remove all lines</button>
            </div>
            <div style={{overflow:'auto', marginTop:12}}>
              <table>
                <thead><tr><th style={{width:120}}>Order ↕</th><th>Title</th><th style={{textAlign:'center'}}>Qty</th><th>MRP</th><th style={{textAlign:'center'}}>Rate</th><th>Disc%</th><th>Tax%</th><th>Amount</th><th style={{textAlign:'center'}}>Net</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l,i)=>{ const r=computeLine(l); const isActive = dragIndex===i; const isTarget = dragOverIndex===i && dragIndex!==null && dragIndex!==i; const isEditingLine = editingLineIndex===i; return (
                    <tr
                      key={i}
                      draggable={lines.length>1}
                      onDragStart={()=>handleDragStart(i)}
                      onDragEnter={()=>handleDragEnter(i)}
                      onDragOver={e=>e.preventDefault()}
                      onDragEnd={handleDragEnd}
                      onDrop={e=>{ e.preventDefault(); e.stopPropagation(); const after=dragIndexRef.current!==null && dragIndexRef.current < i; handleDrop(i,{ after }); }}
                      style={{
                        backgroundColor: isEditingLine ? '#e0f2fe' : isTarget ? '#e0f2fe' : undefined,
                        opacity: isActive ? 0.6 : 1,
                        cursor: lines.length>1 ? 'move' : 'default',
                        boxShadow: isEditingLine ? 'inset 0 0 0 2px rgba(14,165,233,0.45)' : undefined
                      }}
                    >
                      <td className="invoice-line__order-cell">
                        <div className="invoice-line__order-handle" aria-hidden="true">☰</div>
                        <span className="invoice-line__order-index">{i+1}</span>
                        <input
                          className="input invoice-line__order-input"
                          value={l.order ?? ''}
                          onChange={e=>{
                            const value=e.target.value;
                            updateLine(i,{ order:value });
                          }}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder={String(i+1)}
                          aria-label="Serial number"
                        />
                      </td>
                      <td>
                        <div className="invoice-line__details">
                          {isEditingLine ? (
                            <>
                              <input
                                className="input invoice-line__title-input"
                                value={l.title || ""}
                                onChange={e=>updateLine(i,{title:e.target.value})}
                                placeholder="Book title"
                                aria-label="Book title"
                              />
                              <div className="invoice-line__meta">
                                <input
                                  className="input invoice-line__meta-input"
                                  value={l.author || ""}
                                  onChange={e=>updateLine(i,{author:e.target.value})}
                                  placeholder="Author"
                                  aria-label="Book author"
                                />
                                <input
                                  className="input invoice-line__meta-input"
                                  value={l.publisher || ""}
                                  onChange={e=>updateLine(i,{publisher:e.target.value})}
                                  placeholder="Publisher"
                                  aria-label="Book publisher"
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="invoice-line__title-display">
                                {l.title ? l.title : <span className="invoice-line__placeholder">Untitled book</span>}
                              </div>
                              <div className="invoice-line__meta-display">
                                {l.author && <span>{l.author}</span>}
                                {l.publisher && <span>{l.publisher}</span>}
                                {!l.author && !l.publisher && (
                                  <span className="invoice-line__placeholder">No author or publisher</span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                      <td style={{textAlign:'center'}}><input className="input" value={l.qty} onChange={e=>updateLine(i,{qty:asNumber(e.target.value,1)})} style={{textAlign:'center'}} /></td>
                      <td style={{textAlign:'center'}}>
                        <input
                          className="input"
                          value={l.mrp}
                          onChange={(e)=>updateLine(i,{mrp:asNumber(e.target.value,0)})}
                          style={{textAlign:'center'}}
                        />
                      </td>
                      <td style={{textAlign:'center'}}><input className="input" value={l.rate} placeholder="(MRP)" onChange={e=>updateLine(i,{rate:e.target.value})} style={{textAlign:'center'}} /></td>
                      <td><input className="input" value={l.discountPct} onChange={e=>updateLine(i,{discountPct:asNumber(e.target.value,0)})} /></td>
                      <td><input className="input" value={l.taxPct} onChange={e=>updateLine(i,{taxPct:asNumber(e.target.value,0)})} /></td>
                      <td style={{textAlign:'right', fontWeight:500}}>{formatINR(r.amount)}</td>
                      <td style={{textAlign:'center', fontWeight:600, color:'#0ea5e9'}}>{formatINR(r.net)}</td>
                      <td>
                        <div className="invoice-line__actions">
                          {isEditingLine ? (
                            <button className="btn sky" onClick={()=>setEditingLineIndex(null)}>Done</button>
                          ) : (
                            <button className="btn gray" onClick={()=>setEditingLineIndex(i)}>Edit</button>
                          )}
                          <button className="btn gray" onClick={()=>removeLine(i)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  )})}
                  {!lines.length && <tr><td colSpan="10" style={{color:'#64748b', textAlign:'center'}}>No lines yet — search above or open the Books tab to add titles.</td></tr>}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="2" style={{textAlign:'right', fontWeight:700}}>Totals</td>
                    <td style={{textAlign:'center', fontWeight:700}}>{formatQuantity(totals.qty)}</td>
                    <td colSpan="4"></td>
                    <td style={{textAlign:'right'}}>{formatINR(totals.amount)}</td>
                    <td style={{textAlign:'center', color:'#0ea5e9', fontWeight:700}}>{formatINR(totals.net)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="totals-panel">
              <div className="totals-panel__grid">
                <div className="totals-panel__item">
                  <span className="totals-panel__label">Total Quantity</span>
                  <span className="totals-panel__value">{formatQuantity(totals.qty)}</span>
                </div>
                <div className="totals-panel__item">
                  <span className="totals-panel__label">Taxable Amount</span>
                  <span className="totals-panel__value">{formatINR(totals.taxable)}</span>
                </div>
                {totals.discount > 0.0001 && (
                  <div className="totals-panel__item">
                    <span className="totals-panel__label">Total Discount</span>
                    <span className="totals-panel__value">{formatINR(totals.discount)}</span>
                  </div>
                )}
                <div className="totals-panel__item">
                  <span className="totals-panel__label">Total Tax</span>
                  <span className="totals-panel__value">{formatINR(totals.tax)}</span>
                </div>
                <div className="totals-panel__item totals-panel__highlight">
                  <span className="totals-panel__label">Grand Total</span>
                  <span className="totals-panel__value">{formatINR(totals.net)}</span>
                </div>
              </div>
              <div className="totals-panel__words">
                <span className="totals-panel__label">Amount in Words</span>
                <p>{amountInWords}</p>
              </div>
            </div>
          </div>
        )}
      </div>
      {isCustomerModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={e=>{ if(e.target===e.currentTarget) closeCustomerModal(); }}>
          <div className="modal-panel">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
              <h3 style={{margin:0, fontSize:18}}>{isEditingCustomer ? 'Edit Customer' : 'Add Customer'}</h3>
              <button className="btn gray" type="button" onClick={closeCustomerModal}>Close</button>
            </div>
            <p style={{marginTop:0, fontSize:13, color:'#475569'}}>Capture a quick customer record without touching your CSV. We will keep it in your local list.</p>
            <form onSubmit={submitCustomerForm}>
              <div style={{display:'grid', gap:12}}>
                <div style={{display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
                  <div>
                    <label>Invoice No *</label>
                    <input className="input" value={customerForm.invoice_no} onChange={e=>setCustomerForm(prev=>({ ...prev, invoice_no:e.target.value }))} required />
                  </div>
                  <div>
                    <label>Customer Name *</label>
                    <input className="input" value={customerForm.customer_name} onChange={e=>setCustomerForm(prev=>({ ...prev, customer_name:e.target.value }))} required />
                  </div>
                </div>
                <div>
                  <label>Billing Address</label>
                  <textarea className="input" rows={3} value={customerForm.billing_address} onChange={e=>setCustomerForm(prev=>({ ...prev, billing_address:e.target.value }))} />
                </div>
                <div>
                  <label>Shipping Address</label>
                  <textarea className="input" rows={3} value={customerForm.shipping_address} onChange={e=>setCustomerForm(prev=>({ ...prev, shipping_address:e.target.value }))} placeholder="Defaults to billing address" />
                </div>
                <div style={{display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
                  <div>
                    <label>GSTIN</label>
                    <input className="input" value={customerForm.gstin} onChange={e=>setCustomerForm(prev=>({ ...prev, gstin:e.target.value }))} />
                  </div>
                  <div>
                    <label>PAN</label>
                    <input className="input" value={customerForm.pan} onChange={e=>setCustomerForm(prev=>({ ...prev, pan:e.target.value }))} />
                  </div>
                  <div>
                    <label>Place of Supply</label>
                    <input className="input" value={customerForm.place_of_supply} onChange={e=>setCustomerForm(prev=>({ ...prev, place_of_supply:e.target.value }))} />
                  </div>
                </div>
                <div style={{display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
                  <div>
                    <label>Email</label>
                    <input className="input" value={customerForm.email} onChange={e=>setCustomerForm(prev=>({ ...prev, email:e.target.value }))} />
                  </div>
                  <div>
                    <label>Phone</label>
                    <input className="input" value={customerForm.phone} onChange={e=>setCustomerForm(prev=>({ ...prev, phone:e.target.value }))} />
                  </div>
                </div>
                <div style={{display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
                  <div>
                    <label>Invoice Date</label>
                    <input className="input" value={customerForm.invoice_date} onChange={e=>setCustomerForm(prev=>({ ...prev, invoice_date:e.target.value }))} placeholder="DD-MM-YYYY" />
                  </div>
                  <div>
                    <label>Due Date</label>
                    <input className="input" value={customerForm.due_date} onChange={e=>setCustomerForm(prev=>({ ...prev, due_date:e.target.value }))} placeholder="DD-MM-YYYY" />
                  </div>
                </div>
                <div>
                  <label>Notes</label>
                  <textarea className="input" rows={3} value={customerForm.notes} onChange={e=>setCustomerForm(prev=>({ ...prev, notes:e.target.value }))} />
                </div>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color:'#0f172a'}}>
                  <input type="checkbox" checked={autoSelectNewCustomer} onChange={e=>setAutoSelectNewCustomer(e.target.checked)} />
                  <span>Use this customer for the current invoice</span>
                </label>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
                  <button className="btn gray" type="button" onClick={closeCustomerModal}>Cancel</button>
                  <button className="btn sky" type="submit">{isEditingCustomer ? 'Update Customer' : 'Save Customer'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {isBookModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={e=>{ if(e.target===e.currentTarget) setIsBookModalOpen(false); }}>
          <div className="modal-panel">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
              <h3 style={{margin:0, fontSize:18}}>Add Book</h3>
              <button className="btn gray" type="button" onClick={()=>setIsBookModalOpen(false)}>Close</button>
            </div>
            <p style={{marginTop:0, fontSize:13, color:'#475569'}}>Drop in a quick title without editing your CSV. We will keep it in your local catalog.</p>
            <form onSubmit={submitBookForm}>
              <div style={{display:'grid', gap:12}}>
                <div>
                  <label>Title *</label>
                  <input className="input" value={bookForm.title} onChange={e=>setBookForm(prev=>({ ...prev, title:e.target.value }))} required />
                </div>
                <div>
                  <label>Author</label>
                  <input className="input" value={bookForm.author} onChange={e=>setBookForm(prev=>({ ...prev, author:e.target.value }))} />
                </div>
                <div>
                  <label>Publisher</label>
                  <input className="input" value={bookForm.publisher} onChange={e=>setBookForm(prev=>({ ...prev, publisher:e.target.value }))} />
                </div>
                <div>
                  <label>SKU</label>
                  <input className="input" value={bookForm.sku} onChange={e=>setBookForm(prev=>({ ...prev, sku:e.target.value }))} />
                </div>
                <div style={{display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))'}}>
                  <div>
                    <label>MRP</label>
                    <input className="input" value={bookForm.mrp} onChange={e=>setBookForm(prev=>({ ...prev, mrp:e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label>Default Discount %</label>
                    <input className="input" value={bookForm.default_discount_pct} onChange={e=>setBookForm(prev=>({ ...prev, default_discount_pct:e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label>Default Tax %</label>
                    <input className="input" value={bookForm.default_tax_pct} onChange={e=>setBookForm(prev=>({ ...prev, default_tax_pct:e.target.value }))} placeholder={String(defaultTaxPct??0)} />
                  </div>
                </div>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color:'#0f172a'}}>
                  <input type="checkbox" checked={autoAddNewBook} onChange={e=>setAutoAddNewBook(e.target.checked)} />
                  <span>Add to current invoice</span>
                </label>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
                  <button className="btn gray" type="button" onClick={()=>setIsBookModalOpen(false)}>Cancel</button>
                  <button className="btn sky" type="submit">Save Book</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
