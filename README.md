# Bulk Invoice Generator – v2

A zero-cost, client‑side React app for high‑volume PDF invoice generation (single or bulk ZIP), tailored for Garani Publication.

## Features
- **Tabs:** Customers • Books • Invoice
- Import **customers.csv**, **books_catalog.csv**, and optional **line_items.csv**
- Build/edit invoice interactively (add from Books tab, edit qty/rate/discount/tax)
- Manually add quick one-off books with an in-app modal
- Save, load, and delete invoice drafts with automatic Supabase sync (falls back to browser storage when Supabase is not configured)
- Books, customers, and generated invoices persist to Supabase Postgres when credentials are provided
- **Generate Single PDF** or **ZIP of PDFs** (one per customer)
- All PDF generation happens **locally** in your browser

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

## Data persistence & Supabase setup
- When Supabase credentials are supplied the app keeps **books**, **customers**, and **draft invoices** in Postgres and automatically appends every generated invoice (single or batch) to an `invoices` ledger.
- If credentials are missing the UI gracefully falls back to browser `localStorage`, so you can keep working offline and sync later.

### Environment variables
Create a `.env.local` (or export variables before `npm run dev`) with:

```bash
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon key>"
VITE_SUPABASE_WORKSPACE="garani-publication" # any partitioning label you prefer
```

- **Tip:** Copy the exact **Project URL** from the Supabase dashboard. It should look like
  `https://your-project-ref.supabase.co` (note the dot before `supabase.co`).

The optional `VITE_SUPABASE_WORKSPACE` lets you isolate data per business unit or environment. Every row the app writes includes this `workspace_id` so you can enforce row-level security policies in Supabase.

### Recommended schema
Run the SQL in [`supabase/schema.sql`](supabase/schema.sql) inside the Supabase SQL editor (or `psql`). It creates four tables and the composite unique indexes the React client relies on:

- `books` – catalog entries (`workspace_id`, `uid`, `sku`, `title`, `author`, `publisher`, pricing defaults, timestamps).
- `customers` – roster (`workspace_id`, `uid`, `invoice_no`, contact fields, GST/PAN, notes, timestamps, optional JSON `meta`).
- `draft_invoices` – saved work-in-progress invoices with JSON `meta`, `lines`, `pdf_column_prefs`, and `updated_at` for ordering.
- `invoices` – append-only audit log capturing every generated invoice (`workspace_id`, `invoice_no`, `customer_name`, `meta`, `items`, `totals`, `pdf_column_prefs`, `source`, `created_at`).

Each table carries a `workspace_id` and `uid` (except the append-only `invoices` table, which uses a UUID primary key) so you can enable Row Level Security and policies such as `auth.uid()` ↔ workspace checks. Add triggers to maintain `updated_at` automatically if you prefer server-side timestamps.

## Switch back to `₹` symbol (optional)
Embed a TTF font that supports the rupee glyph and set it in jsPDF:
```js
// doc.addFileToVFS('NotoSans-Regular.ttf', base64Data);
// doc.addFont('NotoSans-Regular.ttf', 'noto', 'normal');
// doc.setFont('noto');
```
