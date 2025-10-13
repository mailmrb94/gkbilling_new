import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import JSZip from "jszip";
import * as FileSaver from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import dayjs from "dayjs";

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

function renderInvoicePdf({ meta, items, totals, brand, columnOptions }) {
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
  const prefs = columnOptions || {};
  const includeDiscount = prefs.discount ?? (totals.discount > 0.0001 || items.some(it=>asNumber(it.discountPct||0)));
  const includeTax = prefs.tax ?? true;
  const includeAmount = prefs.amount ?? true;
  const head = [["#","Title / Description","Qty","Rate",...(includeDiscount?["Disc%"]:[]),...(includeTax?["Tax%"]:[]),...(includeAmount?["Amount"]:[]),"Net"]];
  const body = items.map((it,i)=>{
    const r=computeLine(it);
    const row=[String(i+1), `${it.title}${it.author?`\n${it.author}`:""}${it.publisher?` • ${it.publisher}`:""}`, String(it.qty||1), formatINR(r.appliedRate)];
    if(includeDiscount) row.push(String(asNumber(it.discountPct||0)));
    if(includeTax) row.push(String(asNumber(it.taxPct||0)));
    if(includeAmount) row.push(formatINR(r.amount));
    row.push(formatINR(r.net));
    return row;
  });
  const columnStyles={0:{cellWidth:22},1:{cellWidth:(pageWidth-80)*0.42},2:{halign:"right",cellWidth:34},3:{halign:"right",cellWidth:70}};
  let colIndex=4;
  if(includeDiscount){ columnStyles[colIndex]={halign:"right",cellWidth:44}; colIndex+=1; }
  if(includeTax){ columnStyles[colIndex]={halign:"right",cellWidth:44}; colIndex+=1; }
  if(includeAmount){ columnStyles[colIndex]={halign:"right",cellWidth:80}; colIndex+=1; }
  columnStyles[colIndex]={halign:"right",cellWidth:80};
  autoTable(doc,{
    startY, head, body, styles:{ fontSize:9 }, headStyles:{ fillColor:[30,41,59] }, margin:{ left:40, right:40 },
    columnStyles
  });

  const y1 = doc.lastAutoTable?.finalY || startY+100;
  const totalsRows=[["Taxable Amount", formatINR(totals.taxable)]];
  if(includeDiscount) totalsRows.push(["Total Discount", formatINR(totals.discount)]);
  totalsRows.push(["Total Tax", formatINR(totals.tax)],["Grand Total", formatINR(totals.net)]);
  autoTable(doc,{
    startY:y1+10, theme:"plain", margin:{ left:40, right:40 }, styles:{ fontSize:11, halign:"center" },
    body: totalsRows.map(([k,v])=>[{content:k, styles:{ fontStyle:"bold" }},{content:v}]),
    columnStyles:{0:{cellWidth:(pageWidth-80)*0.7},1:{cellWidth:(pageWidth-80)*0.3}}
  });

  autoTable(doc,{
    startY:(doc.lastAutoTable?.finalY||y1+60)+8, theme:"plain", margin:{ left:40, right:40 }, styles:{ fontSize:9, halign:"center" },
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
  const [savedInvoices,setSavedInvoices]=usePersistentState("data.savedInvoices", []);
  const [defaultTaxPct,setDefaultTaxPct]=usePersistentState("settings.defaultTaxPct", 18);
  const [pdfColumnPrefs,setPdfColumnPrefs]=usePersistentState("settings.pdfColumnPrefs", () => ({}));
  const [filter,setFilter]=usePersistentState("ui.filter", "");
  const [selectedCustomer,setSelectedCustomer]=usePersistentState("ui.selectedCustomer", null);
  const [dragIndex,setDragIndex]=useState(null);
  const [dragOverIndex,setDragOverIndex]=useState(null);
  const [isBookModalOpen,setIsBookModalOpen]=useState(false);
  const [bookForm,setBookForm]=useState(()=>({ sku:"", title:"", author:"", publisher:"", mrp:"", default_discount_pct:"", default_tax_pct:"" }));
  const [autoAddNewBook,setAutoAddNewBook]=useState(true);
  const [draftLabel,setDraftLabel]=useState("");
  const dragIndexRef = React.useRef(null);

  useEffect(()=>{
    if(!isBookModalOpen) return;
    const handler=(event)=>{
      if(event.key==='Escape') setIsBookModalOpen(false);
    };
    window.addEventListener('keydown', handler);
    return ()=>window.removeEventListener('keydown', handler);
  },[isBookModalOpen]);

  const filteredBooks = useMemo(()=>{ const q=filter.trim().toLowerCase(); if(!q) return catalog; return catalog.filter(b=>[b.sku,b.title,b.author,b.publisher].filter(Boolean).some(f=>String(f).toLowerCase().includes(q))); },[filter,catalog]);

  function addLine(b){
    const fallbackTax = defaultTaxPct ?? 0;
    const taxValue = b.default_tax_pct !== undefined ? b.default_tax_pct : fallbackTax;
    setLines(p=>[...p,{
      sku:b.sku,
      title:b.title,
      author:b.author,
      publisher:b.publisher,
      qty:1,
      mrp:asNumber(b.mrp),
      rate:"",
      discountPct:asNumber(b.default_discount_pct||0),
      taxPct:asNumber(taxValue)
    }]);
  }
  function addAllBooks(list){
    if(!list.length) return;
    setLines(prev=>{
      const existingKeys = new Set(prev.map(l=>`${l.sku||""}__${l.title||""}`));
      const additions = [];
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
          taxPct:asNumber(taxValue)
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
  function reorderLines(from,to){
    if(from===null || to===null || from===to) return;
    setLines(prev=>{
      if(from<0 || from>=prev.length || to<0 || to>=prev.length) return prev;
      const next=[...prev];
      const [moved]=next.splice(from,1);
      next.splice(to,0,moved);
      return next;
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
  function removeLine(i){ setLines(p=>p.filter((_,idx)=>idx!==i)); }

  const totals = useMemo(()=>lines.reduce((a,it)=>{ const r=computeLine(it); a.amount+=r.amount; a.discount+=r.discountAmt; a.taxable+=r.taxable; a.tax+=r.taxAmt; a.net+=r.net; return a; },{ amount:0, discount:0, taxable:0, tax:0, net:0 }),[lines]);
  const autoDiscountColumn = useMemo(()=>totals.discount > 0.0001 || lines.some(it=>asNumber(it.discountPct||0)),[totals.discount,lines]);
  const pdfColumns = useMemo(()=>({
    discount: pdfColumnPrefs.discount ?? autoDiscountColumn,
    tax: pdfColumnPrefs.tax ?? true,
    amount: pdfColumnPrefs.amount ?? true
  }),[pdfColumnPrefs,autoDiscountColumn]);
  const hasCustomPdfColumns = useMemo(()=>Object.keys(pdfColumnPrefs).length>0,[pdfColumnPrefs]);

  const togglePdfColumn = (key) => {
    setPdfColumnPrefs(prev=>({ ...prev, [key]: !pdfColumns[key] }));
  };
  const resetPdfColumns = () => setPdfColumnPrefs({});

  const statEntries = useMemo(()=>[
    { label:"Customers Loaded", value: customers.length },
    { label:"Books Catalogued", value: catalog.length },
    { label:"Visible Books", value: filteredBooks.length },
    { label:"Invoice Lines", value: lines.length },
    { label:"Current Invoice Net", value: formatINR(totals.net) }
  ],[customers.length,catalog.length,filteredBooks.length,lines.length,totals.net]);

  async function onLoadCatalog(e){ const f=e.target.files?.[0]; if(!f) return; const rows=await parseCsv(f); const norm=rows.map(r=>({ sku:r.sku??r.SKU??"", title:r.title??r.Title??r.book_title??"", author:r.author??r.Author??"", publisher:r.publisher??r.Publisher??"", mrp:asNumber(r.mrp??r.MRP), default_discount_pct:asNumber(r.default_discount_pct??r.discount??0), default_tax_pct:asNumber(r.default_tax_pct??r.tax??r.gst??0) })); setCatalog(norm); }
  async function onLoadCustomers(e){ const f=e.target.files?.[0]; if(!f) return; const rows=await parseCsv(f); setCustomers(rows); }
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

  function generateSingle(){ const meta=currentInvoiceMeta(); const doc=renderInvoicePdf({ meta, items:lines, totals, columnOptions:pdfColumnPrefs }); doc.save(`${meta.invoice_no||"invoice"}.pdf`); }

  function openAddBookModal(){
    setBookForm({ sku:"", title:"", author:"", publisher:"", mrp:"", default_discount_pct:"", default_tax_pct:"" });
    setAutoAddNewBook(true);
    setIsBookModalOpen(true);
  }

  function upsertBook(book){
    setCatalog(prev=>{
      const next=[...prev];
      const targetKey=(val)=>String(val||"").trim().toLowerCase();
      const matchIndex=next.findIndex(existing=>{
        if(book.sku && existing.sku){
          return targetKey(existing.sku)===targetKey(book.sku);
        }
        return targetKey(existing.title)===targetKey(book.title);
      });
      if(matchIndex>=0){
        next[matchIndex]={ ...next[matchIndex], ...book };
      }else{
        next.push(book);
      }
      return next;
    });
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

  function saveCurrentDraft(){
    if(!lines.length){ alert("Add at least one line item before saving a draft."); return; }
    const meta=currentInvoiceMeta();
    const label=(draftLabel||meta.invoice_no||"Draft").trim();
    const timestamp=new Date().toISOString();
    setSavedInvoices(prev=>{
      const linesCopy=lines.map(l=>({ ...l }));
      const payload={
        label:label||"Draft",
        lines:linesCopy,
        meta:{ ...meta },
        pdfColumnPrefs:{ ...pdfColumnPrefs },
        createdAt:timestamp,
        updatedAt:timestamp
      };
      const existingIndex=prev.findIndex(d=>d.label.toLowerCase()===payload.label.toLowerCase());
      if(existingIndex>=0){
        const existing=prev[existingIndex];
        const ensuredId=existing.id || existing.label || `draft-${Date.now()}`;
        const updated={ ...existing, ...payload, id:ensuredId, createdAt:existing.createdAt||timestamp, updatedAt:timestamp };
        const clone=[...prev];
        clone[existingIndex]=updated;
        return clone.sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
      }
      const id=`draft-${Date.now()}`;
      const merged={ id, ...payload };
      return [...prev, merged].sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime());
    });
    setDraftLabel(label||"Draft");
  }

  function loadDraft(draft){
    if(!draft) return;
    setLines(draft.lines?.map(l=>({ ...l }))||[]);
    setPdfColumnPrefs(draft.pdfColumnPrefs||{});
    setSelectedCustomer(draft.meta||null);
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
          return {
            title,
            author:match?.author||li.author||"",
            publisher:match?.publisher||li.publisher||"",
            qty:asNumber(li.qty||1),
            mrp:asNumber(li.mrp??match?.mrp??li.rate_override??0),
            rate:li.rate_override??"",
            discountPct:asNumber(li.discount_pct_override??match?.default_discount_pct??0),
            taxPct:asNumber(taxSource)
          };
        });
      const used = perItems.length?perItems:lines;
      const totals=used.reduce((a,it)=>{ const r=computeLine(it); a.amount+=r.amount; a.discount+=r.discountAmt; a.taxable+=r.taxable; a.tax+=r.taxAmt; a.net+=r.net; return a; },{ amount:0, discount:0, taxable:0, tax:0, net:0 });
      const doc=renderInvoicePdf({ meta:cust, items:used, totals, columnOptions:pdfColumnPrefs });
      const blob=doc.output("blob");
      zip.file(`${invNo||"invoice"}.pdf`, blob);
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
              <h2>Customers CSV</h2>
              <span className="pill">{customers.length ? `${customers.length} customers loaded` : 'Awaiting CSV upload'}</span>
            </div>
            <p style={{color:'#475569', marginTop:0}}>Load customers and then switch to Invoice tab to preview or batch-generate colourful PDFs.</p>
            <input type="file" accept=".csv" onChange={onLoadCustomers} />
            <div style={{maxHeight:360, overflow:'auto', marginTop:16}}>
              <table>
                <thead><tr><th>Invoice No</th><th>Name</th><th>Billing</th><th>Shipping</th><th>GSTIN</th></tr></thead>
                <tbody>
                  {customers.map((c,i)=>(<tr key={i}><td>{c.invoice_no}</td><td>{c.customer_name}</td><td>{c.billing_address}</td><td>{c.shipping_address}</td><td>{c.gstin||'-'}</td></tr>))}
                  {!customers.length && <tr><td colSpan="5" style={{color:'#64748b', textAlign:'center'}}>No customers loaded</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='books' && (
          <div>
            <div className="section-header">
              <h2>Books Catalog</h2>
              <span className="pill">{filteredBooks.length} matching titles</span>
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
              <h2>Invoice Builder</h2>
              <span className="pill">{lines.length ? `${lines.length} line items ready` : 'Add titles from the catalog'}</span>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:16}}>
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
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                <h3 style={{margin:0, fontSize:16, color:'#0f172a'}}>PDF Columns</h3>
                {hasCustomPdfColumns && (
                  <button className="btn gray" style={{padding:'6px 12px', fontSize:12}} onClick={resetPdfColumns}>Reset to defaults</button>
                )}
              </div>
              <p style={{color:'#475569', fontSize:12, marginTop:0, marginBottom:12}}>Pick which columns should appear when you export the invoice PDF.</p>
              <div style={{display:'flex', flexWrap:'wrap', gap:16}}>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.discount} onChange={()=>togglePdfColumn('discount')} />
                  <span>Discount %</span>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.tax} onChange={()=>togglePdfColumn('tax')} />
                  <span>Tax %</span>
                </label>
                <label style={{display:'flex', alignItems:'center', gap:8, fontSize:14, color:'#0f172a'}}>
                  <input type="checkbox" checked={pdfColumns.amount} onChange={()=>togglePdfColumn('amount')} />
                  <span>Amount</span>
                </label>
                <span style={{fontSize:12, color:'#64748b'}}>Net column is always included.</span>
              </div>
            </div>
            <div style={{marginTop:24, padding:'16px', background:'#f1f5f9', borderRadius:12}}>
              <h3 style={{marginTop:0, fontSize:16, color:'#0f172a'}}>Invoice Drafts</h3>
              <p style={{color:'#475569', fontSize:12, marginTop:0}}>Save your current invoice so you can pause mid-way and resume later. Drafts live in your browser storage.</p>
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
            <div style={{overflow:'auto', marginTop:12}}>
              <table>
                <thead><tr><th style={{width:72}}>Order ↕</th><th>Title</th><th>Qty</th><th>MRP</th><th>Rate</th><th>Disc%</th><th>Tax%</th><th>Amount</th><th>Net</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l,i)=>{ const r=computeLine(l); const isActive = dragIndex===i; const isTarget = dragOverIndex===i && dragIndex!==null && dragIndex!==i; return (
                    <tr
                      key={i}
                      draggable={lines.length>1}
                      onDragStart={()=>handleDragStart(i)}
                      onDragEnter={()=>handleDragEnter(i)}
                      onDragOver={e=>e.preventDefault()}
                      onDragEnd={handleDragEnd}
                      onDrop={e=>{ e.preventDefault(); e.stopPropagation(); const after=dragIndexRef.current!==null && dragIndexRef.current < i; handleDrop(i,{ after }); }}
                      style={{
                        backgroundColor: isTarget ? '#e0f2fe' : undefined,
                        opacity: isActive ? 0.6 : 1,
                        cursor: lines.length>1 ? 'move' : 'default'
                      }}
                    >
                      <td style={{textAlign:'center', fontWeight:600, color:'#334155'}}>
                        <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:2}}>
                          <span aria-hidden="true" style={{fontSize:12, color:'#94a3b8'}}>☰</span>
                          <span>{i+1}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{fontWeight:600, color:'#0f172a'}}>{l.title}</div>
                        <div style={{fontSize:12, color:'#64748b'}}>{[l.author,l.publisher].filter(Boolean).join(' • ')}</div>
                      </td>
                      <td><input className="input" value={l.qty} onChange={e=>updateLine(i,{qty:asNumber(e.target.value,1)})} /></td>
                      <td style={{textAlign:'right', fontWeight:500}}>{formatINR(l.mrp)}</td>
                      <td><input className="input" value={l.rate} placeholder="(MRP)" onChange={e=>updateLine(i,{rate:e.target.value})} /></td>
                      <td><input className="input" value={l.discountPct} onChange={e=>updateLine(i,{discountPct:asNumber(e.target.value,0)})} /></td>
                      <td><input className="input" value={l.taxPct} onChange={e=>updateLine(i,{taxPct:asNumber(e.target.value,0)})} /></td>
                      <td style={{textAlign:'right', fontWeight:500}}>{formatINR(r.amount)}</td>
                      <td style={{textAlign:'right', fontWeight:600, color:'#0ea5e9'}}>{formatINR(r.net)}</td>
                      <td><button className="btn gray" onClick={()=>removeLine(i)}>Remove</button></td>
                    </tr>
                  )})}
                  {!lines.length && <tr><td colSpan="10" style={{color:'#64748b', textAlign:'center'}}>No lines yet — go to Books tab and click “Add”.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan="7" style={{textAlign:'right', fontWeight:700}}>Totals</td><td style={{textAlign:'right'}}>{formatINR(totals.amount)}</td><td style={{textAlign:'right', color:'#0ea5e9', fontWeight:700}}>{formatINR(totals.net)}</td><td></td></tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
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
