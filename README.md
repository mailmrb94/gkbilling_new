# Bulk Invoice Generator – v2

A zero-cost, client‑side React app for high‑volume PDF invoice generation (single or bulk ZIP), tailored for Garani Publication.

## Features
- **Tabs:** Customers • Books • Invoice
- Import **customers.csv**, **books_catalog.csv**, and optional **line_items.csv**
- Build/edit invoice interactively (add from Books tab, edit qty/rate/discount/tax)
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

## Switch back to `₹` symbol (optional)
Embed a TTF font that supports the rupee glyph and set it in jsPDF:
```js
// doc.addFileToVFS('NotoSans-Regular.ttf', base64Data);
// doc.addFont('NotoSans-Regular.ttf', 'noto', 'normal');
// doc.setFont('noto');
```
