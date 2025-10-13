# Bulk Invoice Generator – v2

A zero-cost, client‑side React app for high‑volume PDF invoice generation (single or bulk ZIP), tailored for Garani Publication.

## Features
- **Tabs:** Customers • Books • Invoice
- Import **customers.csv**, **books_catalog.csv**, and optional **line_items.csv**
- Build/edit invoice interactively (add from Books tab, edit qty/rate/discount/tax)
- Manually add quick one-off books with an in-app modal
- Save, load, and delete invoice drafts stored in browser localStorage
- **Generate Single PDF** or **ZIP of PDFs** (one per customer)
- All processing runs **locally** in your browser

## Why rates showed a leading `1`
jsPDF's default Helvetica font does not support the `₹` glyph, which rendered as a stray `1`.  
**Fix:** this build formats money as `Rs 1,234.56`. If you prefer the rupee symbol, we can embed a Unicode TTF font.

## Run
```bash
npm install
npm run dev
```
Open `http://localhost:5173`

## CSV Schemas
### books_catalog.csv
`sku,title,author,publisher,mrp,default_discount_pct,default_tax_pct`

### customers.csv
`invoice_no,invoice_date,due_date,customer_name,billing_address,shipping_address,gstin,pan,place_of_supply,notes`

### line_items.csv` (optional)
`invoice_no,sku_or_title,qty,rate_override,discount_pct_override,tax_pct_override`

If `line_items.csv` is omitted, the interactive lines you add in the **Invoice** tab are used for all customers during batch.

## Build static site
```bash
npm run build
npm run preview
```

## Save drafts now, move to a real database later
- Drafts you save in the **Invoice** tab live entirely in the browser's `localStorage` (key `data.savedInvoices`).
- To migrate to a hosted backend, map that draft shape `{ label, lines, meta, pdfColumnPrefs }` into a persistence layer of your choice.
- **Supabase** works great if you want instant hosted Postgres with row-level security and auth. Define tables for `customers`, `catalog`, and `invoice_drafts`, then swap the `usePersistentState` hooks for API calls.
- For a quick local-first stack, SQLite via tools such as **ElectricSQL**, **Turso/libSQL**, or even a desktop Electron shell would work. You can also point the app at a REST/GraphQL API that wraps SQLite/MySQL/Postgres.
- When you wire up a backend, keep the optimistic localStorage draft so users can continue offline and sync changes when online.

## Switch back to `₹` symbol (optional)
Embed a TTF font that supports the rupee glyph and set it in jsPDF:
```js
// doc.addFileToVFS('NotoSans-Regular.ttf', base64Data);
// doc.addFont('NotoSans-Regular.ttf', 'noto', 'normal');
// doc.setFont('noto');
```
