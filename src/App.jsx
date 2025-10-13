import React, { useMemo, useState } from "react";
import Papa from "papaparse";
import JSZip from "jszip";
import * as FileSaver from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import dayjs from "dayjs";

const saveAs = FileSaver.saveAs || FileSaver.default;

// Currency without rupee glyph to avoid jsPDF helvetica fallback rendering '1'
function formatINR(n){ const num = Number(n||0); return "Rs " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num); }
function asNumber(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }

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

function renderInvoicePdf({ meta, items, totals, brand }) {
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  brand = brand || { name: "GARANI PUBLICATION", address: "Old No.5A, New E351, 7th A Main Road, MSR Layout, Havanuru Layout, Bengaluru Urban, Bengaluru, Karnataka, 560073", phone: "Mobile: 9108447657", gstin: "GSTIN: 29CBIPN0092E1ZM" };
  doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.text(brand.name, 40, 40);
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text(brand.address, 40, 58, { maxWidth: pageWidth-80 });
  doc.text(`${brand.phone}    ${brand.gstin}`, 40, 74);

  const y0=95;
  const left = [["Invoice No.", meta.invoice_no||"-"],["Invoice Date", meta.invoice_date||dayjs().format("DD-MM-YYYY")],["Due Date", meta.due_date||"-"]];
  const right = [["Place of Supply", meta.place_of_supply||"Karnataka"],["GSTIN", meta.gstin||"-"],["PAN", meta.pan||"-"]];
  autoTable(doc,{
    startY:y0, theme:"plain", styles:{ fontSize:10, cellPadding:2 }, margin:{ left:40, right:40 },
    body:[[
      {content:`Bill To\n${meta.customer_name||"-"}\n${meta.billing_address||"-"}`},
      {content:`Ship To\n${meta.shipping_address||meta.billing_address||"-"}`},
      {content:left.map(([k,v])=>`${k}: ${v}`).join("\n")+"\n"+right.map(([k,v])=>`${k}: ${v}`).join("\n")}
    ]],
    columnStyles:{0:{cellWidth:(pageWidth-80)*0.34},1:{cellWidth:(pageWidth-80)*0.33},2:{cellWidth:(pageWidth-80)*0.33}}
  });

  const startY = (doc.lastAutoTable?.finalY || y0+110) + 10;
  const head = [["#","Title / Description","Qty","Rate","Disc%","Tax%","Amount","Net"]];
  const body = items.map((it,i)=>{ const r=computeLine(it); return [String(i+1), `${it.title}${it.author?`\n${it.author}`:""}${it.publisher?` • ${it.publisher}`:""}`, String(it.qty||1), formatINR(r.appliedRate), String(asNumber(it.discountPct||0)), String(asNumber(it.taxPct||0)), formatINR(r.amount), formatINR(r.net) ];});
  autoTable(doc,{
    startY, head, body, styles:{ fontSize:9 }, headStyles:{ fillColor:[30,41,59] }, margin:{ left:40, right:40 },
    columnStyles:{0:{cellWidth:22},1:{cellWidth:(pageWidth-80)*0.42},2:{halign:"right",cellWidth:34},3:{halign:"right",cellWidth:70},4:{halign:"right",cellWidth:44},5:{halign:"right",cellWidth:44},6:{halign:"right",cellWidth:80},7:{halign:"right",cellWidth:80}}
  });

  const y1 = doc.lastAutoTable?.finalY || startY+100;
  const totalsRows = [["Taxable Amount", formatINR(totals.taxable)],["Total Discount", formatINR(totals.discount)],["Total Tax", formatINR(totals.tax)],["Grand Total", formatINR(totals.net)]];
  autoTable(doc,{
    startY:y1+10, theme:"plain", margin:{ left:40, right:40 }, styles:{ fontSize:11 },
    body: totalsRows.map(([k,v])=>[{content:k, styles:{ halign:"right", fontStyle:"bold" }},{content:v, styles:{ halign:"right" }}]),
    columnStyles:{0:{cellWidth:(pageWidth-80)*0.7},1:{cellWidth:(pageWidth-80)*0.3}}
  });

  autoTable(doc,{
    startY:(doc.lastAutoTable?.finalY||y1+60)+8, theme:"plain", margin:{ left:40, right:40 }, styles:{ fontSize:9 },
    body:[[ {content:(meta.notes?`Notes: ${meta.notes}\n\n`:"")+"TERMS AND CONDITIONS\n1. Goods once sold will not be taken back or exchanged\n2. All disputes are subject to Bengaluru jurisdiction only"} ]]
  });
  return doc;
}

export default function App(){
  const [tab, setTab] = useState("customers"); // customers | books | invoice
  const [catalog,setCatalog]=useState([]);
  const [customers,setCustomers]=useState([]);
  const [batchItems,setBatchItems]=useState([]);
  const [lines,setLines]=useState([]);
  const [filter,setFilter]=useState("");
  const [selectedCustomer,setSelectedCustomer]=useState(null);

  const filteredBooks = useMemo(()=>{ const q=filter.trim().toLowerCase(); if(!q) return catalog; return catalog.filter(b=>[b.sku,b.title,b.author,b.publisher].filter(Boolean).some(f=>String(f).toLowerCase().includes(q))); },[filter,catalog]);

  function addLine(b){ setLines(p=>[...p,{ sku:b.sku, title:b.title, author:b.author, publisher:b.publisher, qty:1, mrp:asNumber(b.mrp), rate:"", discountPct:asNumber(b.default_discount_pct||0), taxPct:asNumber(b.default_tax_pct||0) }]); }
  function updateLine(i,patch){ setLines(p=>p.map((l,idx)=>idx===i?{...l,...patch}:l)); }
  function removeLine(i){ setLines(p=>p.filter((_,idx)=>idx!==i)); }

  const totals = useMemo(()=>lines.reduce((a,it)=>{ const r=computeLine(it); a.amount+=r.amount; a.discount+=r.discountAmt; a.taxable+=r.taxable; a.tax+=r.taxAmt; a.net+=r.net; return a; },{ amount:0, discount:0, taxable:0, tax:0, net:0 }),[lines]);

  async function onLoadCatalog(e){ const f=e.target.files?.[0]; if(!f) return; const rows=await parseCsv(f); const norm=rows.map(r=>({ sku:r.sku??r.SKU??"", title:r.title??r.Title??r.book_title??"", author:r.author??r.Author??"", publisher:r.publisher??r.Publisher??"", mrp:asNumber(r.mrp??r.MRP), default_discount_pct:asNumber(r.default_discount_pct??r.discount??0), default_tax_pct:asNumber(r.default_tax_pct??r.tax??r.gst??0) })); setCatalog(norm); }
  async function onLoadCustomers(e){ const f=e.target.files?.[0]; if(!f) return; const rows=await parseCsv(f); setCustomers(rows); }
  async function onLoadItems(e){ const f=e.target.files?.[0]; if(!f) return; const rows=await parseCsv(f); setBatchItems(rows); }

  function pickCustomer(inv){ const c=customers.find(r=>String(r.invoice_no)===String(inv)); if(c) setSelectedCustomer(c); }

  function generateSingle(){ const meta=selectedCustomer||{ invoice_no:"DRAFT-001", invoice_date:dayjs().format("DD-MM-YYYY"), due_date:dayjs().format("DD-MM-YYYY"), customer_name:"Walk-in Customer", billing_address:"", shipping_address:"", gstin:"", pan:"", place_of_supply:"Karnataka", notes:"" }; const doc=renderInvoicePdf({ meta, items:lines, totals }); doc.save(`${meta.invoice_no||"invoice"}.pdf`); }

  async function generateBatch(){ if(!customers.length){ alert("Load customers.csv first"); return; } const zip=new JSZip(); for(const cust of customers){ const invNo=cust.invoice_no; const perItems=(batchItems.length?batchItems:lines).filter(li=>batchItems.length?String(li.invoice_no)===String(invNo):true).map(li=>{ const match=catalog.find(b=>String(b.sku)===String(li.sku_or_title)||String(b.title).toLowerCase()===String(li.sku_or_title).toLowerCase()); const title=match?.title||li.sku_or_title||li.title||"Item"; return { title, author:match?.author||li.author||"", publisher:match?.publisher||li.publisher||"", qty:asNumber(li.qty||1), mrp:asNumber(li.mrp??match?.mrp??li.rate_override??0), rate:li.rate_override??"", discountPct:asNumber(li.discount_pct_override??match?.default_discount_pct??0), taxPct:asNumber(li.tax_pct_override??match?.default_tax_pct??0) }; }); const used = perItems.length?perItems:lines; const totals=used.reduce((a,it)=>{ const r=computeLine(it); a.amount+=r.amount; a.discount+=r.discountAmt; a.taxable+=r.taxable; a.tax+=r.taxAmt; a.net+=r.net; return a; },{ amount:0, discount:0, taxable:0, tax:0, net:0 }); const doc=renderInvoicePdf({ meta:cust, items:used, totals }); const blob=doc.output("blob"); zip.file(`${invNo||"invoice"}.pdf`, blob); } const out=await zip.generateAsync({ type:"blob" }); saveAs(out, `invoices_${dayjs().format("YYYYMMDD_HHmm")}.zip`); }

  return (
    <div className="min-h-screen" style={{padding:16}}>
      <h1 className="text-2xl" style={{fontWeight:700}}>Bulk Invoice Generator – Garani Publication</h1>
      <div style={{marginTop:10}}>
        <button className={"tab "+(tab==='customers'?'active':'')} onClick={()=>setTab('customers')}>Customers</button>
        <button className={"tab "+(tab==='books'?'active':'')} onClick={()=>setTab('books')}>Books</button>
        <button className={"tab "+(tab==='invoice'?'active':'')} onClick={()=>setTab('invoice')}>Invoice</button>
      </div>

      <div className="card" style={{marginTop:0, borderTopLeftRadius:0}}>
        {tab==='customers' && (
          <div>
            <h2 className="text-xl" style={{fontWeight:600}}>Customers CSV</h2>
            <p className="text-sm" style={{color:'#475569'}}>Load customers and then switch to Invoice tab to preview or batch-generate.</p>
            <input type="file" accept=".csv" onChange={onLoadCustomers} />
            <div style={{maxHeight:360, overflow:'auto', marginTop:10}}>
              <table>
                <thead><tr><th>Invoice No</th><th>Name</th><th>Billing</th><th>Shipping</th><th>GSTIN</th></tr></thead>
                <tbody>
                  {customers.map((c,i)=>(<tr key={i}><td>{c.invoice_no}</td><td>{c.customer_name}</td><td>{c.billing_address}</td><td>{c.shipping_address}</td><td>{c.gstin||'-'}</td></tr>))}
                  {!customers.length && <tr><td colSpan="5" style={{color:'#64748b'}}>No customers loaded</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='books' && (
          <div>
            <h2 className="text-xl" style={{fontWeight:600}}>Books Catalog</h2>
            <input type="file" accept=".csv" onChange={onLoadCatalog} />
            <div style={{marginTop:8}}>
              <input className="input" placeholder="Search title/author/publisher" value={filter} onChange={e=>setFilter(e.target.value)} />
            </div>
            <div style={{maxHeight:360, overflow:'auto', marginTop:10}}>
              <table>
                <thead><tr><th>SKU</th><th>Title</th><th>Author</th><th>Publisher</th><th>MRP</th><th>Default Disc%</th><th>Add</th></tr></thead>
                <tbody>
                  {filteredBooks.map((b,i)=>(<tr key={i}><td>{b.sku}</td><td>{b.title}</td><td>{b.author}</td><td>{b.publisher}</td><td>{formatINR(b.mrp)}</td><td>{b.default_discount_pct||0}</td><td><button className="btn gray" onClick={()=>addLine(b)}>Add</button></td></tr>))}
                  {!filteredBooks.length && <tr><td colSpan="7" style={{color:'#64748b'}}>No books loaded</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='invoice' && (
          <div>
            <h2 className="text-xl" style={{fontWeight:600}}>Invoice Builder</h2>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12}}>
              <div>
                <label>Pick Customer by invoice_no</label>
                <input className="input" placeholder="Type invoice_no" onChange={(e)=>pickCustomer(e.target.value)} />
                <button className="btn dark" style={{marginTop:8, width:'100%'}} onClick={generateSingle}>Generate Single PDF</button>
              </div>
              <div>
                <label>Optional Line Items CSV (for batch)</label>
                <input type="file" accept=".csv" onChange={onLoadItems} />
              </div>
              <div>
                <label>Batch Output</label>
                <button className="btn green" style={{display:'block', width:'100%'}} onClick={generateBatch}>Generate ZIP of PDFs</button>
              </div>
            </div>
            <div style={{overflow:'auto', marginTop:12}}>
              <table>
                <thead><tr><th>Title</th><th>Qty</th><th>MRP</th><th>Rate</th><th>Disc%</th><th>Tax%</th><th>Amount</th><th>Net</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l,i)=>{ const r=computeLine(l); return (
                    <tr key={i}>
                      <td><div style={{fontWeight:600}}>{l.title}</div><div style={{fontSize:12, color:'#64748b'}}>{[l.author,l.publisher].filter(Boolean).join(' • ')}</div></td>
                      <td><input className="input" value={l.qty} onChange={e=>updateLine(i,{qty:asNumber(e.target.value,1)})} /></td>
                      <td style={{textAlign:'right'}}>{formatINR(l.mrp)}</td>
                      <td><input className="input" value={l.rate} placeholder="(MRP)" onChange={e=>updateLine(i,{rate:e.target.value})} /></td>
                      <td><input className="input" value={l.discountPct} onChange={e=>updateLine(i,{discountPct:asNumber(e.target.value,0)})} /></td>
                      <td><input className="input" value={l.taxPct} onChange={e=>updateLine(i,{taxPct:asNumber(e.target.value,0)})} /></td>
                      <td style={{textAlign:'right'}}>{formatINR(r.amount)}</td>
                      <td style={{textAlign:'right'}}>{formatINR(r.net)}</td>
                      <td><button className="btn gray" onClick={()=>removeLine(i)}>Remove</button></td>
                    </tr>
                  )})}
                  {!lines.length && <tr><td colSpan="9" style={{color:'#64748b'}}>No lines yet — go to Books tab and click “Add”.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan="6" style={{textAlign:'right', fontWeight:700}}>Totals</td><td style={{textAlign:'right'}}>{formatINR(totals.amount)}</td><td style={{textAlign:'right'}}>{formatINR(totals.net)}</td><td></td></tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
