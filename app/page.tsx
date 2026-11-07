"use client";

import Image from "next/image";
import { FormEvent, KeyboardEvent, RefObject, useEffect, useMemo, useRef, useState } from "react";

type Entity = { _id: string; name?: string; title?: string; phone?: string; address?: string; percentage?: number; price?: number; cost?: number; stock?: number; createdAt?: string };
type BillItem = { bookId: string; bookTitle: string; price: number; quantity: number; discountPercent: number; gross: number; discountAmount: number; total: number };
type Bill = { _id: string; billNo: string; customerName: string; salesmanName: string; totalAmount: number; profit?: number; createdAt: string; items: BillItem[]; customerId?: string; salesmanId: string; isWalkIn: boolean; customerPhone?: string; customerAddress?: string };
type Page = "dashboard" | "books" | "customers" | "salesmen" | "bill" | "invoices";
declare global { interface Window { generatePDF?: (billNo: string, customer: string, salesman: string, items: Array<{ bookText: string; price: number; qty: number; gross: number; discountAmount: number; total: number }>, total: number, phone: string, address: string, printWindow?: Window | null) => Promise<void>; jspdf?: { jsPDF: new (...args: unknown[]) => { autoTable?: unknown } }; Chart?: new (canvas: HTMLCanvasElement, config: Record<string, unknown>) => { destroy: () => void }; } }
const money = (value: number | undefined) => `Rs. ${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
async function api<T>(url: string, init?: RequestInit): Promise<T> { const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }); const body = await res.json(); if (!body.success) throw new Error(body.error ?? "Request failed"); return body.data as T; }
const ROWS_PER_PAGE = 9;

function useTableState<T extends { _id: string }>(rows: T[], query: string, resetKey: string) {
  const key = `${resetKey}|${query}`;
  const [state, setState] = useState<{ key: string; page: number; selected: string[]; pending: string[] | null }>({ key, page: 1, selected: [], pending: null });
  const [deleting, setDeleting] = useState(false);
  const active = state.key === key ? state : { key, page: 1, selected: [] as string[], pending: null as string[] | null };
  const filtered = useMemo(() => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase().trim())), [rows, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const current = Math.min(active.page, totalPages);
  const pageRows = filtered.slice((current - 1) * ROWS_PER_PAGE, current * ROWS_PER_PAGE);
  const pageIds = pageRows.map((row) => row._id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => active.selected.includes(id));
  const setPage = (page: number) => setState({ ...active, page });
  const setSelected = (next: string[] | ((list: string[]) => string[])) => setState({ ...active, selected: typeof next === "function" ? next(active.selected) : next });
  const setPending = (next: string[] | null) => setState({ ...active, pending: next });
  const toggleRow = (id: string) => setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const toggleAll = () => setSelected((list) => allSelected ? [] : Array.from(new Set([...list, ...pageIds])));
  return { filtered, page: current, setPage, totalPages, pageRows, pageIds, allSelected, selected: active.selected, setSelected, pending: active.pending, setPending, deleting, setDeleting, toggleRow, toggleAll };
}

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  if (total === 0) return <div className="pagination"><span className="page-info">No records</span></div>;
  const start = (page - 1) * ROWS_PER_PAGE + 1;
  const end = Math.min(page * ROWS_PER_PAGE, total);
  const items: Array<number | string> = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) items.push(i);
    else if (i === page - 2 || i === page + 2) items.push(`dots-${i}`);
  }
  return <div className="pagination"><span className="page-info">Showing {start}-{end} of {total}</span><div className="page-btns"><button className="page-btn" disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button>{items.map((item) => typeof item === "number" ? <button key={item} className={item === page ? "page-btn active" : "page-btn"} onClick={() => onChange(item)}>{item}</button> : <span key={item} className="page-dots">...</span>)}<button className="page-btn" disabled={page === totalPages} onClick={() => onChange(page + 1)}>›</button></div></div>;
}

function ConfirmDialog({ count, label, busy, onCancel, onConfirm }: { count: number; label: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-modal" role="dialog" aria-modal="true"><div className="confirm-box"><div className="confirm-icon">⚠</div><div className="confirm-message">Are you sure you want to delete <strong>{count}</strong> {label}?</div><div className="confirm-buttons"><button className="confirm-btn confirm-btn-no" disabled={busy} onClick={onCancel}>No</button><button className="confirm-btn confirm-btn-yes" disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : "Yes"}</button></div></div></div>;
}

let pdfEnginePromise: Promise<void> | null = null;
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}
async function ensurePdfEngine() {
  if (!window.jspdf?.jsPDF) await loadScript("/assets/js/jspdf.min.js");
  let hasAutoTable = false;
  try { hasAutoTable = typeof new window.jspdf!.jsPDF().autoTable === "function"; } catch { hasAutoTable = false; }
  if (!hasAutoTable) await loadScript("/assets/js/jspdf.autotable.min.js");
  if (typeof window.generatePDF !== "function") await loadScript("/assets/js/legacy-bill-pdf.js");
  if (typeof window.generatePDF !== "function") throw new Error("PDF engine failed to initialize");
}
function loadPdfEngine(): Promise<void> {
  if (pdfEnginePromise) return pdfEnginePromise;
  pdfEnginePromise = ensurePdfEngine().catch((error) => { pdfEnginePromise = null; throw error; });
  return pdfEnginePromise;
}

let chartPromise: Promise<void> | null = null;
function loadChart(): Promise<void> {
  if (chartPromise) return chartPromise;
  chartPromise = (async () => {
    if (!window.Chart) await loadScript("/assets/js/chart.min.js");
    if (!window.Chart) throw new Error("Chart.js failed to load");
  })().catch((error) => { chartPromise = null; throw error; });
  return chartPromise;
}

export default function Home() {
  const [page, setPage] = useState<Page>("dashboard"); const [books, setBooks] = useState<Entity[]>([]); const [customers, setCustomers] = useState<Entity[]>([]); const [salesmen, setSalesmen] = useState<Entity[]>([]); const [bills, setBills] = useState<Bill[]>([]); const [notice, setNotice] = useState(""); const [modal, setModal] = useState<{ kind: "books" | "customers" | "salesmen"; row?: Entity } | null>(null); const [editingBill, setEditingBill] = useState<Bill | null>(null); const [sidebarCollapsed, setSidebarCollapsed] = useState(false); const [mobileMenuOpen, setMobileMenuOpen] = useState(false); const [loggedIn, setLoggedIn] = useState<boolean | null>(null); const [pdfReady, setPdfReady] = useState(false);
  const reload = async () => { try { const [b, c, s, i] = await Promise.all([api<Entity[]>("/api/books"), api<Entity[]>("/api/customers"), api<Entity[]>("/api/salesmen"), api<Bill[]>("/api/bills")]); setBooks(b); setCustomers(c); setSalesmen(s); setBills(i); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load data. Check MongoDB connection."); } };
  useEffect(() => {
    let active = true;
    loadPdfEngine().then(() => { if (active) setPdfReady(true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void api<{ authenticated: boolean }>("/api/auth/session").then((data) => { setLoggedIn(data.authenticated); if (data.authenticated) void reload(); }).catch(() => setLoggedIn(false)); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3500); };
  const navigate = (next: Page) => { setEditingBill(null); setPage(next); setMobileMenuOpen(false); };
  const removeMany = async (kind: "books" | "customers" | "salesmen" | "bills", ids: string[]) => { let removed = 0; let failed = 0; for (const id of ids) { try { await api(`/api/${kind}?id=${id}`, { method: "DELETE" }); removed += 1; } catch { failed += 1; } } await reload(); notify(failed ? `${removed} deleted, ${failed} failed.` : `${removed} ${removed === 1 ? "record" : "records"} deleted successfully.`); };
  const content = page === "dashboard" ? <Dashboard books={books} customers={customers} salesmen={salesmen} bills={bills} onInvoices={() => navigate("invoices")} /> : page === "bill" ? <BillExperience books={books} customers={customers} salesmen={salesmen} initial={editingBill} pdfReady={pdfReady} onDone={async () => { await reload(); setEditingBill(null); navigate("invoices"); notify("Bill saved and stock updated."); }} /> : page === "invoices" ? <Invoices bills={bills} onEdit={(bill) => { setEditingBill(bill); setPage("bill"); }} onRefund={async (bill) => { if (!window.confirm(`Refund bill ${bill.billNo}? Stock will be restored.`)) return; try { await api(`/api/bills?id=${bill._id}&action=refund`, { method: "POST" }); await reload(); notify(`Bill ${bill.billNo} refunded.`); } catch (error) { notify(error instanceof Error ? error.message : "Refund failed"); } }} onDeleteMany={(ids) => removeMany("bills", ids)} /> : <CrudList kind={page} rows={page === "books" ? books : page === "customers" ? customers : salesmen} onAdd={() => setModal({ kind: page })} onEdit={(row) => setModal({ kind: page, row })} onDeleteMany={(ids) => removeMany(page, ids)} onAddStock={async (row) => { const amount = Number(window.prompt("How many books would you like to add?", "1")); if (!Number.isInteger(amount) || amount <= 0) return; try { await api(`/api/books?id=${row._id}&action=add_stock`, { method: "POST", body: JSON.stringify({ addStock: amount }) }); await reload(); notify("Stock updated."); } catch (error) { notify(error instanceof Error ? error.message : "Stock update failed"); } }} />;
  const toggleSidebar = () => { if (window.innerWidth <= 768) setMobileMenuOpen((open) => !open); else setSidebarCollapsed((collapsed) => !collapsed); };
  if (loggedIn === null) return <div className="auth-loading">Loading...</div>;
  if (!loggedIn) return <LoginScreen onLogin={() => { setLoggedIn(true); void reload(); }} />;
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); setLoggedIn(false); };
  return <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileMenuOpen ? "mobile-menu-open" : ""}`}><aside className="sidebar"><div className="logo-container"><span className="full-logo">Best Publishers</span><span className="short-logo">BP</span></div><nav className="sidebar-nav">{([ ["dashboard", "⌂", "Dashboard"], ["books", "▣", "Books"], ["customers", "♟", "Customers"], ["salesmen", "♙", "Salesman"], ["bill", "▤", "Bill"], ["invoices", "▧", "Invoices"] ] as [Page, string, string][]).map(([key, icon, label]) => <button key={key} className={page === key ? "nav active" : "nav"} onClick={() => navigate(key)}><b>{icon}</b><span>{label}</span></button>)}<div className="nav-spacer" /><button className="nav logout-nav" onClick={() => void logout()}><b>↪</b><span>Logout</span></button></nav></aside><button className="sidebar-overlay" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} /><section className="workspace"><header className="topbar"><button className="burger-btn" aria-label="Toggle menu" onClick={toggleSidebar}>☰</button><div className="top-search">⌕ <span>Search...</span></div><div className="profile"><strong>A</strong><span>Admin<small>Administrator</small></span></div></header>{notice && <div className="notice">{notice}</div>}<div className="content">{content}</div></section>{modal && <EntityModal modal={modal} onClose={() => setModal(null)} onSaved={async () => { await reload(); setModal(null); notify("Saved successfully."); }} />}</main>;
}

function LoginScreen({ onLogin }: { onLogin: () => void }) { const [username, setUsername] = useState("admin"); const [password, setPassword] = useState(""); const [showPassword, setShowPassword] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); onLogin(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Login failed"); setLoading(false); } }; return <main className="login-page"><div className="legacy-login-card"><form className="login-form-panel" onSubmit={(event) => void submit(event)}><div className="login-brand">▣ &nbsp; BEST PUBLISHERS</div><h1 className="login-title">Welcome Back!</h1><p className="login-subtitle">Sign in to your account to continue</p>{error && <div className="login-error">⚠ {error}</div>}<label className="login-field">Username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter your username" autoFocus /></label><label className="login-field">Password<div className="password-wrap"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "◉" : "◌"}</button></div></label><button disabled={loading} className="login-btn">{loading ? "Signing in..." : "↪  Sign In"}</button></form><section className="login-logo-panel"><div className="logo-ring"><Image src="/assets/logo.png" alt="Best Publishers" width={160} height={160} priority /></div><div className="logo-company">Best Publishers</div><div className="logo-tagline">Wholesale &amp; Retail Books Supplier</div></section></div></main>; }

function Dashboard({ books, customers, salesmen, bills, onInvoices }: { books: Entity[]; customers: Entity[]; salesmen: Entity[]; bills: Bill[]; onInvoices: () => void }) {
  const barRef = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);
  const [chartReady, setChartReady] = useState(false);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [filterResult, setFilterResult] = useState<{ revenue: number; profit: number; margin: string; count: number } | null>(null);

  useEffect(() => {
    let active = true;
    loadChart().then(() => { if (active) setChartReady(true); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const thisMonth = now.toISOString().slice(0, 7);
    const thisYear = String(now.getFullYear());
    const totalRevenue = bills.reduce((sum, bill) => sum + bill.totalAmount, 0);
    const totalProfit = bills.reduce((sum, bill) => sum + (bill.profit ?? 0), 0);
    const dailyRevenue = bills.filter((bill) => (bill.createdAt ?? "").startsWith(today)).reduce((sum, bill) => sum + bill.totalAmount, 0);
    const monthlyRevenue = bills.filter((bill) => (bill.createdAt ?? "").startsWith(thisMonth)).reduce((sum, bill) => sum + bill.totalAmount, 0);
    const yearlyProfit = bills.filter((bill) => (bill.createdAt ?? "").startsWith(thisYear)).reduce((sum, bill) => sum + (bill.profit ?? 0), 0);
    return { totalRevenue, totalProfit, dailyRevenue, monthlyRevenue, yearlyProfit, margin: totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : "0" };
  }, [bills]);

  const monthlyData = useMemo(() => {
    const rows: Array<{ label: string; revenue: number; profit: number }> = [];
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date();
      date.setMonth(date.getMonth() - offset);
      const key = date.toISOString().slice(0, 7);
      rows.push({
        label: date.toLocaleString("default", { month: "short" }),
        revenue: bills.filter((bill) => (bill.createdAt ?? "").startsWith(key)).reduce((sum, bill) => sum + bill.totalAmount, 0),
        profit: bills.filter((bill) => (bill.createdAt ?? "").startsWith(key)).reduce((sum, bill) => sum + (bill.profit ?? 0), 0),
      });
    }
    return rows;
  }, [bills]);

  const salesmanData = useMemo(
    () => salesmen.map((salesman) => ({ name: salesman.name ?? "", revenue: bills.filter((bill) => bill.salesmanId === salesman._id).reduce((sum, bill) => sum + bill.totalAmount, 0) })),
    [salesmen, bills],
  );

  useEffect(() => {
    const Chart = window.Chart;
    if (!chartReady || !Chart) return;
    const charts: Array<{ destroy: () => void }> = [];
    if (barRef.current) {
      charts.push(new Chart(barRef.current, {
        type: "bar",
        data: {
          labels: salesmanData.map((salesman) => salesman.name),
          datasets: [{ label: "Revenue (Rs.)", data: salesmanData.map((salesman) => salesman.revenue), backgroundColor: salesmanData.map((_, index) => ["#d4af37", "#1a1a2e", "#888", "#c0a020", "#555"][index % 5]), borderRadius: 8, borderSkipped: false }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#888", font: { size: 11 } } },
            y: { grid: { color: "#f0f0f0" }, ticks: { color: "#888", font: { size: 11 }, callback: (value: number) => `Rs.${value.toLocaleString()}` } },
          },
        },
      }));
    }
    if (lineRef.current) {
      charts.push(new Chart(lineRef.current, {
        type: "line",
        data: {
          labels: monthlyData.map((row) => row.label),
          datasets: [
            { label: "Revenue", data: monthlyData.map((row) => row.revenue), borderColor: "#d4af37", backgroundColor: "rgba(212,175,55,0.08)", borderWidth: 2.5, pointBackgroundColor: "#d4af37", pointRadius: 4, tension: 0.4, fill: true },
            { label: "Profit", data: monthlyData.map((row) => row.profit), borderColor: "#1a1a2e", backgroundColor: "rgba(26,26,46,0.05)", borderWidth: 2.5, pointBackgroundColor: "#1a1a2e", pointRadius: 4, tension: 0.4, fill: true },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "top", labels: { color: "#333", font: { size: 12 } } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#888" } },
            y: { grid: { color: "#f0f0f0" }, ticks: { color: "#888", callback: (value: number) => `Rs.${value.toLocaleString()}` } },
          },
        },
      }));
    }
    if (donutRef.current) {
      charts.push(new Chart(donutRef.current, {
        type: "doughnut",
        data: { labels: ["Books", "Customers", "Bills"], datasets: [{ data: [books.length, customers.length, bills.length], backgroundColor: ["#d4af37", "#1a1a2e", "#888888"], borderWidth: 0, hoverOffset: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "72%", plugins: { legend: { position: "bottom", labels: { color: "#333", padding: 16, font: { size: 12 } } } } },
      }));
    }
    return () => charts.forEach((chart) => chart.destroy());
  }, [chartReady, monthlyData, salesmanData, books.length, customers.length, bills.length]);

  const applyFilter = () => {
    if (!filterStart || !filterEnd) { window.alert("Please select both dates"); return; }
    const filtered = bills.filter((bill) => { const day = (bill.createdAt ?? "").slice(0, 10); return day >= filterStart && day <= filterEnd; });
    const revenue = filtered.reduce((sum, bill) => sum + bill.totalAmount, 0);
    const profit = filtered.reduce((sum, bill) => sum + (bill.profit ?? 0), 0);
    setFilterResult({ revenue, profit, margin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : "0", count: filtered.length });
  };

  return <>
    <div className="page-header dash-heading">
      <div><h1>Dashboard</h1><p>Welcome back, Admin</p></div>
      <span className="dash-date-chip">{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
    </div>
    <div className="dash-row1">
      <div className="dcard"><div className="dcard-label">Total Books</div><div className="dcard-num">{books.length}</div><div className="dcard-sub">In inventory</div></div>
      <div className="dcard"><div className="dcard-label">Customers</div><div className="dcard-num">{customers.length}</div><div className="dcard-sub">Registered</div></div>
      <div className="dcard"><div className="dcard-label">Total Bills</div><div className="dcard-num">{bills.length}</div><div className="dcard-sub">All time</div></div>
      <div className="dcard"><div className="dcard-label">Salesmen</div><div className="dcard-num">{salesmen.length}</div><div className="dcard-sub">Active</div></div>
      <div className="dcard dcard-gold">
        <div className="dcard-label">Total Revenue</div>
        <div className="dcard-num dcard-num-light">{money(stats.totalRevenue)}</div>
        <div className="dcard-split"><span>Today: {money(stats.dailyRevenue)}</span><span>Monthly: {money(stats.monthlyRevenue)}</span></div>
      </div>
      <div className="dcard dcard-dark">
        <div className="dcard-label">Total Profit</div>
        <div className="dcard-num dcard-num-gold">{money(stats.totalProfit)}</div>
        <div className="dcard-split"><span>Margin: {stats.margin}%</span><span>Yearly: {money(stats.yearlyProfit)}</span></div>
      </div>
    </div>
    <div className="dash-row2">
      <div className="dchart-card"><div className="dchart-header"><span className="dchart-title">Salesman Performance</span></div><div className="chart-box"><canvas ref={barRef} /></div></div>
      <div className="dchart-card"><div className="dchart-header"><span className="dchart-title">Overview</span></div><div className="chart-box"><canvas ref={donutRef} /></div></div>
    </div>
    <div className="dash-row3">
      <div className="dchart-card"><div className="dchart-header"><span className="dchart-title">Revenue vs Profit (6 Months)</span></div><div className="chart-box"><canvas ref={lineRef} /></div></div>
      <div className="dchart-card">
        <div className="dchart-header"><span className="dchart-title">Recent Bills</span><button className="link-btn" onClick={onInvoices}>View all</button></div>
        <table className="recent-table">
          <thead><tr><th>Bill#</th><th>Customer</th><th>Amount</th></tr></thead>
          <tbody>{bills.slice(0, 5).map((bill) => <tr key={bill._id}><td><b>#{bill.billNo}</b></td><td>{bill.customerName || "Walk-in"}</td><td className="recent-amount">{money(bill.totalAmount)}</td></tr>)}{!bills.length && <tr><td colSpan={3} className="empty">No bills yet</td></tr>}</tbody>
        </table>
      </div>
    </div>
    <div className="dchart-card filter-card">
      <div className="dchart-header"><span className="dchart-title">Advanced Financial Filter</span></div>
      <div className="filter-row">
        <label className="filter-field">Start Date<input type="date" value={filterStart} onChange={(event) => setFilterStart(event.target.value)} /></label>
        <label className="filter-field">End Date<input type="date" value={filterEnd} onChange={(event) => setFilterEnd(event.target.value)} /></label>
        <button className="gold-btn filter-btn" onClick={applyFilter}>Filter</button>
      </div>
      {filterResult && <div className="filter-results">
        <div className="fres-card fres-gold"><div className="fres-label">Revenue</div><div className="fres-val">{money(filterResult.revenue)}</div></div>
        <div className="fres-card fres-dark"><div className="fres-label">Net Profit</div><div className="fres-val">{money(filterResult.profit)}</div></div>
        <div className="fres-card"><div className="fres-label">Profit Margin</div><div className="fres-val">{filterResult.margin}%</div></div>
        <div className="fres-card"><div className="fres-label">Total Invoices</div><div className="fres-val">{filterResult.count}</div></div>
      </div>}
    </div>
  </>;
}

function CrudList({ kind, rows, onAdd, onEdit, onDeleteMany, onAddStock }: { kind: "books" | "customers" | "salesmen"; rows: Entity[]; onAdd: () => void; onEdit: (row: Entity) => void; onDeleteMany: (ids: string[]) => Promise<void>; onAddStock: (row: Entity) => void }) {
  const [query, setQuery] = useState("");
  const table = useTableState(rows, query, kind);
  const title = kind === "books" ? "Books Management" : kind === "customers" ? "Customers Management" : "Salesman Management";
  const headers = kind === "books" ? ["Cost", "Price", "Stock"] : kind === "customers" ? ["Phone", "Address", "%"] : ["Phone"];
  const cells = (row: Entity) => kind === "books" ? [money(row.cost), money(row.price), <span className={(row.stock ?? 0) <= 5 ? "stock low" : "stock"} key="stock">{row.stock}</span>] : kind === "customers" ? [row.phone, row.address, `${row.percentage}%`] : [row.phone];
  const noun = (table.pending?.length ?? 0) === 1 ? (kind === "books" ? "book" : kind === "customers" ? "customer" : "salesman") : (kind === "books" ? "books" : kind === "customers" ? "customers" : "salesmen");
  const confirmDelete = async () => { if (!table.pending?.length) return; table.setDeleting(true); try { await onDeleteMany(table.pending); table.setSelected([]); } finally { table.setDeleting(false); table.setPending(null); } };
  return <><div className="page-header"><h1>{title}</h1></div><div className="toolbar"><div className="toolbar-actions"><button className="outline-btn" onClick={onAdd}>＋ Add New {kind === "books" ? "Book" : kind === "customers" ? "Customer" : "Salesman"}</button>{table.selected.length > 0 && <button className="btn-delete-selected" onClick={() => table.setPending(table.selected)}>⌫ Delete ({table.selected.length})</button>}</div><input placeholder={`Search ${kind}...`} value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="panel table-panel"><table><thead><tr><th className="select-col"><input type="checkbox" className="select-checkbox" checked={table.allSelected} ref={(element) => { if (element) element.indeterminate = table.selected.length > 0 && !table.allSelected; }} onChange={table.toggleAll} /></th><th>ID</th><th>{kind === "books" ? "Title" : "Name"}</th>{headers.map((header) => <th key={header}>{header}</th>)}<th>Actions</th></tr></thead><tbody>{table.pageRows.map((row) => <tr key={row._id}><td className="select-col"><input type="checkbox" className="select-checkbox" checked={table.selected.includes(row._id)} onChange={() => table.toggleRow(row._id)} /></td><td>{row._id.slice(-6)}</td><td>{row.title ?? row.name}</td>{cells(row).map((cell, index) => <td key={index}>{cell}</td>)}<td className="actions">{kind === "books" ? <button title="Add stock" onClick={() => onAddStock(row)}>＋</button> : null}<button title="Edit" onClick={() => onEdit(row)}>✎</button><button className="danger" title="Delete" onClick={() => table.setPending([row._id])}>⌫</button></td></tr>)}{!table.pageRows.length && <tr><td colSpan={headers.length + 4} className="empty">No records found</td></tr>}</tbody></table><Pagination page={table.page} totalPages={table.totalPages} total={table.filtered.length} onChange={table.setPage} /></div>{table.pending && <ConfirmDialog count={table.pending.length} label={noun} busy={table.deleting} onCancel={() => table.setPending(null)} onConfirm={() => void confirmDelete()} />}</>;
}

function EntityModal({ modal, onClose, onSaved }: { modal: { kind: "books" | "customers" | "salesmen"; row?: Entity }; onClose: () => void; onSaved: () => Promise<void> }) {
  const row = modal.row; const [saving, setSaving] = useState(false); const [form, setForm] = useState<Record<string, string>>({ title: row?.title ?? "", name: row?.name ?? "", phone: row?.phone ?? "", address: row?.address ?? "", percentage: String(row?.percentage ?? 0), cost: String(row?.cost ?? ""), price: String(row?.price ?? ""), stock: String(row?.stock ?? "") }); const isBook = modal.kind === "books";
  const submit = async (event: FormEvent) => { event.preventDefault(); if (saving) return; setSaving(true); try { const body = isBook ? { title: form.title, cost: Number(form.cost), price: Number(form.price), stock: Number(form.stock) } : { name: form.name, phone: form.phone, ...(modal.kind === "customers" ? { address: form.address, percentage: Number(form.percentage) } : {}) }; await api(`/api/${modal.kind}${row ? `?id=${row._id}` : ""}`, { method: row ? "PUT" : "POST", body: JSON.stringify(body) }); await onSaved(); } catch (error) { window.alert(error instanceof Error ? error.message : "Save failed"); setSaving(false); } };
  const field = (name: string, label: string, type = "text") => <label>{label}<input disabled={saving} required={name === "title" || name === "name" || isBook} type={type} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} /></label>;
  return <div className="overlay"><form className="modal" onSubmit={(event) => void submit(event)}><div className="modal-head"><h3>{row ? "Edit" : "Add New"} {isBook ? "Book" : modal.kind === "customers" ? "Customer" : "Salesman"}</h3><button disabled={saving} type="button" onClick={onClose}>×</button></div><div className="modal-body">{isBook ? <>{field("title", "Title")}{field("cost", "Cost (Purchase Price)", "number")}{field("price", "Price (Selling Price)", "number")}{field("stock", "Stock", "number")}</> : <>{field("name", "Name")}{field("phone", "Phone")}{modal.kind === "customers" && <><label>Address<textarea disabled={saving} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>{field("percentage", "Discount Percentage (%)", "number")}</>}</>}</div><div className="modal-foot"><button disabled={saving} type="button" className="outline-btn" onClick={onClose}>Cancel</button><button disabled={saving} className="gold-btn">{saving ? "Saving..." : "Save"}</button></div></form></div>;
}

function BillEditor({ books, customers, salesmen, initial, onDone }: { books: Entity[]; customers: Entity[]; salesmen: Entity[]; initial: Bill | null; onDone: () => Promise<void> }) { const [customerId, setCustomerId] = useState(initial?.customerId ?? ""); const [salesmanId, setSalesmanId] = useState(initial?.salesmanId ?? ""); const [walkIn, setWalkIn] = useState(initial?.isWalkIn ?? false); const [walk, setWalk] = useState({ name: initial?.customerName ?? "", phone: initial?.customerPhone ?? "", address: initial?.customerAddress ?? "" }); const [bookId, setBookId] = useState(""); const [quantity, setQuantity] = useState(1); const [discount, setDiscount] = useState(0); const [items, setItems] = useState<BillItem[]>(initial?.items ?? []); const [saving, setSaving] = useState(false);
  const add = () => { const book = books.find((entry) => entry._id === bookId); if (!book) return; const current = items.find((item) => item.bookId === bookId); if (quantity < 1 || quantity + (current?.quantity ?? 0) > (book.stock ?? 0)) return window.alert(`Only ${book.stock} in stock.`); const gross = (book.price ?? 0) * quantity; const item = { bookId, bookTitle: book.title ?? "", price: book.price ?? 0, quantity, discountPercent: discount, gross, discountAmount: gross * discount / 100, total: gross * (1 - discount / 100) }; setItems(current ? items.map((entry) => entry.bookId === bookId ? { ...item, quantity: entry.quantity + quantity, gross: item.price * (entry.quantity + quantity), discountAmount: item.price * (entry.quantity + quantity) * discount / 100, total: item.price * (entry.quantity + quantity) * (1 - discount / 100) } : entry) : [...items, item]); setBookId(""); setQuantity(1); };
  const edit = (index: number, field: "quantity" | "discountPercent", value: number) => { const item = items[index]; const book = books.find((entry) => entry._id === item.bookId); if (field === "quantity" && (value < 1 || value > (book?.stock ?? item.quantity))) return; const next = { ...item, [field]: value }; next.gross = next.price * next.quantity; next.discountAmount = next.gross * next.discountPercent / 100; next.total = next.gross - next.discountAmount; setItems(items.map((entry, idx) => idx === index ? next : entry)); };
  const total = items.reduce((sum, item) => sum + item.total, 0); const submit = async () => { if ((!walkIn && !customerId) || !salesmanId || !items.length || (walkIn && !walk.name.trim())) return window.alert("Please complete customer, salesman and item details."); setSaving(true); try { const payload = { customerId, salesmanId, walkIn: walkIn ? walk : null, items: items.map(({ bookId: id, quantity: qty, discountPercent }) => ({ bookId: id, quantity: qty, discountPercent })) }; await api(`/api/bills${initial ? `?id=${initial._id}` : ""}`, { method: initial ? "PUT" : "POST", body: JSON.stringify(payload) }); window.print(); await onDone(); } catch (error) { window.alert(error instanceof Error ? error.message : "Bill save failed"); } finally { setSaving(false); } };
  return <><div className="page-header"><h1>{initial ? `Edit Bill #${initial.billNo}` : "Create Bill"}</h1></div><div className="bill-card"><div className="bill-fields"><label>Customer<select disabled={walkIn} value={customerId} onChange={(event) => { setCustomerId(event.target.value); const customer = customers.find((entry) => entry._id === event.target.value); if (customer) setDiscount(customer.percentage ?? 0); }}><option value="">Select customer</option>{customers.map((customer) => <option key={customer._id} value={customer._id}>{customer.name} ({customer.percentage ?? 0}%)</option>)}</select></label><label>Salesman<select value={salesmanId} onChange={(event) => setSalesmanId(event.target.value)}><option value="">Select salesman</option>{salesmen.map((salesman) => <option key={salesman._id} value={salesman._id}>{salesman.name}</option>)}</select></label><label className="walk"><input type="checkbox" checked={walkIn} onChange={(event) => setWalkIn(event.target.checked)} /> Walk-in Customer</label></div>{walkIn && <div className="walk-fields"><input placeholder="Customer name *" value={walk.name} onChange={(event) => setWalk({ ...walk, name: event.target.value })} /><input placeholder="Phone" value={walk.phone} onChange={(event) => setWalk({ ...walk, phone: event.target.value })} /><input placeholder="Address" value={walk.address} onChange={(event) => setWalk({ ...walk, address: event.target.value })} /></div>}<div className="add-line"><select value={bookId} onChange={(event) => setBookId(event.target.value)}><option value="">Search / select book</option>{books.filter((book) => (book.stock ?? 0) > 0).map((book) => <option key={book._id} value={book._id}>{book.title} (Stock: {book.stock})</option>)}</select><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /><input type="number" min="0" max="100" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /><button className="outline-btn" onClick={add}>Add Item</button></div><div className="panel table-panel"><table><thead><tr><th>#</th><th>Book Title</th><th>Unit Price</th><th>Qty</th><th>Gross</th><th>Discount</th><th>Net Amount</th><th></th></tr></thead><tbody>{items.map((item, index) => <tr key={item.bookId}><td>{index + 1}</td><td>{item.bookTitle}</td><td>{money(item.price)}</td><td><input className="cell-input" type="number" value={item.quantity} onChange={(event) => edit(index, "quantity", Number(event.target.value))} /></td><td>{money(item.gross)}</td><td><input className="cell-input" type="number" value={item.discountPercent} onChange={(event) => edit(index, "discountPercent", Number(event.target.value))} />%</td><td>{money(item.total)}</td><td><button className="danger" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></td></tr>)}<tr className="total-row"><td colSpan={6}>GRAND TOTAL</td><td>{money(total)}</td><td></td></tr></tbody></table></div><button disabled={saving} className="gold-btn save-bill" onClick={() => void submit()}>{saving ? "Saving..." : initial ? "Update & Print Bill" : "Save & Print Bill"}</button></div></>; }

function SearchDropdown({ options, value, onValueChange, label, placeholder, onPick, inputRef }: { options: Entity[]; value: string; onValueChange: (value: string) => void; label: (item: Entity) => string; placeholder: string; onPick: (item: Entity) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const [open, setOpen] = useState(false); const [active, setActive] = useState(-1); const results = useMemo(() => options.filter((item) => label(item).toLowerCase().includes(value.toLowerCase().trim())), [options, value, label]);
  const select = (item: Entity) => { onValueChange(label(item)); onPick(item); setOpen(false); setActive(-1); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, results.length - 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); } else if (event.key === "Enter" && results.length) { event.preventDefault(); select(results[active >= 0 ? active : 0]); } else if (event.key === "Escape") setOpen(false); };
  return <div className="searchable-field"><input ref={inputRef} value={value} autoComplete="off" placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { onValueChange(event.target.value); setOpen(true); setActive(-1); }} onKeyDown={keyDown} />{open && value.trim() && <div className="dropdown-list">{results.length ? results.map((item, index) => <button type="button" key={item._id} className={index === active ? "dropdown-item active" : "dropdown-item"} onMouseDown={(event) => { event.preventDefault(); select(item); }}>{label(item)}</button>) : <div className="dropdown-empty">No matching records</div>}</div>}</div>;
}

function BillExperience({ books, customers, salesmen, initial, pdfReady, onDone }: { books: Entity[]; customers: Entity[]; salesmen: Entity[]; initial: Bill | null; pdfReady: boolean; onDone: () => Promise<void> }) {
  const [customerId, setCustomerId] = useState(initial?.customerId ?? ""); const [salesmanId, setSalesmanId] = useState(initial?.salesmanId ?? ""); const [bookId, setBookId] = useState(""); const [customerSearch, setCustomerSearch] = useState(initial?.customerName ?? ""); const [salesmanSearch, setSalesmanSearch] = useState(initial?.salesmanName ?? ""); const [bookSearch, setBookSearch] = useState(""); const [walkIn, setWalkIn] = useState(initial?.isWalkIn ?? false); const [walk, setWalk] = useState({ name: initial?.customerName ?? "", phone: initial?.customerPhone ?? "", address: initial?.customerAddress ?? "" }); const [quantity, setQuantity] = useState(1); const [discount, setDiscount] = useState(0); const [items, setItems] = useState<BillItem[]>(initial?.items ?? []); const [saving, setSaving] = useState(false); const salesmanRef = useRef<HTMLInputElement>(null); const bookRef = useRef<HTMLInputElement>(null); const qtyRef = useRef<HTMLInputElement>(null); const discountRef = useRef<HTMLInputElement>(null); const customerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => { if (!walkIn) customerRef.current?.focus(); }, 50); return () => window.clearTimeout(timer); }, [walkIn]);
  const add = () => { const book = books.find((entry) => entry._id === bookId); if (!book) return window.alert("Please select a book from the dropdown."); const existing = items.find((item) => item.bookId === bookId); if (quantity < 1 || quantity + (existing?.quantity ?? 0) > (book.stock ?? 0)) return window.alert(`'${book.title}' has only ${book.stock} in stock.`); const gross = (book.price ?? 0) * quantity; const item = { bookId, bookTitle: book.title ?? "", price: book.price ?? 0, quantity, discountPercent: discount, gross, discountAmount: gross * discount / 100, total: gross * (1 - discount / 100) }; setItems(existing ? items.map((entry) => entry.bookId === bookId ? { ...item, quantity: entry.quantity + quantity, gross: item.price * (entry.quantity + quantity), discountAmount: item.price * (entry.quantity + quantity) * discount / 100, total: item.price * (entry.quantity + quantity) * (1 - discount / 100) } : entry) : [...items, item]); setBookId(""); setBookSearch(""); setQuantity(1); bookRef.current?.focus(); };
  const total = items.reduce((sum, item) => sum + item.total, 0); const submit = async () => { if ((!walkIn && !customerId) || !salesmanId || !items.length || (walkIn && !walk.name.trim())) return window.alert("Please complete customer, salesman and item details."); if (!pdfReady || !window.generatePDF) return window.alert("PDF engine is still loading. Please wait a moment."); const printWindow = window.open("", "_blank"); setSaving(true); let savedBill: Bill | null = null; try { const saved = await api<Bill>(`/api/bills${initial ? `?id=${initial._id}` : ""}`, { method: initial ? "PUT" : "POST", body: JSON.stringify({ customerId, salesmanId, walkIn: walkIn ? walk : null, items: items.map((item) => ({ bookId: item.bookId, quantity: item.quantity, discountPercent: item.discountPercent })) }) }); const selectedCustomer = customers.find((customer) => customer._id === customerId); const selectedSalesman = salesmen.find((salesman) => salesman._id === salesmanId); await window.generatePDF(saved.billNo, walkIn ? walk.name : selectedCustomer?.name ?? "", selectedSalesman?.name ?? "", items.map((item) => ({ bookText: item.bookTitle, price: item.price, qty: item.quantity, gross: item.gross, discountAmount: item.discountAmount, total: item.total })), saved.totalAmount, walkIn ? walk.phone : selectedCustomer?.phone ?? "", walkIn ? walk.address : selectedCustomer?.address ?? "", printWindow); savedBill = saved; await onDone(); } catch (error) { if (printWindow && !printWindow.closed) printWindow.close(); window.alert(savedBill ? `Bill ${savedBill.billNo} saved, but PDF/print failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "Bill save failed"); setSaving(false); } };
  if (false) return <BillEditor books={books} customers={customers} salesmen={salesmen} initial={initial} onDone={onDone} />;
  return <><div className="page-header bill-heading"><h1>{initial ? `Edit Bill #${initial.billNo}` : "Create Bill"}</h1><button className={walkIn ? "walk-btn active" : "walk-btn"} onClick={() => { setWalkIn(!walkIn); window.setTimeout(() => (walkIn ? customerRef : salesmanRef).current?.focus(), 0); }}>{walkIn ? "Regular Customer" : "Walk-In Customer"}</button></div><div className="bill-form-card"><div className="form-group">{walkIn ? <div className="walk-fields"><label>Customer Name<input autoFocus value={walk.name} placeholder="Enter customer name *" onChange={(event) => setWalk({ ...walk, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") salesmanRef.current?.focus(); }} /></label><label>Phone<input value={walk.phone} placeholder="Enter phone number" onChange={(event) => setWalk({ ...walk, phone: event.target.value })} /></label><label>Address<input value={walk.address} placeholder="Enter address" onChange={(event) => setWalk({ ...walk, address: event.target.value })} /></label></div> : <><label>Customer Name</label><SearchDropdown options={customers} value={customerSearch} onValueChange={(value) => { setCustomerSearch(value); setCustomerId(""); }} label={(customer) => `${customer.name}${customer.percentage ? ` (${customer.percentage}%)` : ""}`} placeholder="Type to search customer..." inputRef={customerRef} onPick={(customer) => { setCustomerId(customer._id); setDiscount(customer.percentage ?? 0); window.setTimeout(() => salesmanRef.current?.focus(), 0); }} />{customerId && <div className="customer-details">{customers.find((customer) => customer._id === customerId)?.phone || "No phone"}<br />{customers.find((customer) => customer._id === customerId)?.address || "No address"}</div>}</>}</div><div className="form-group"><label>Salesman Name</label><SearchDropdown options={salesmen} value={salesmanSearch} onValueChange={(value) => { setSalesmanSearch(value); setSalesmanId(""); }} label={(salesman) => salesman.name ?? ""} placeholder="Type to search salesman..." inputRef={salesmanRef} onPick={(salesman) => { setSalesmanId(salesman._id); window.setTimeout(() => bookRef.current?.focus(), 0); }} /></div><h3>Add Items</h3><div className="form-group"><label>Book Title</label><SearchDropdown options={books.filter((book) => (book.stock ?? 0) > 0)} value={bookSearch} onValueChange={(value) => { setBookSearch(value); setBookId(""); }} label={(book) => `${book.title} (Stock: ${book.stock}) - ${money(book.price)}`} placeholder="Type to search book..." inputRef={bookRef} onPick={(book) => { setBookId(book._id); window.setTimeout(() => qtyRef.current?.focus(), 0); }} /></div><div className="form-row"><label>Quantity<input ref={qtyRef} type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); discountRef.current?.focus(); } }} /></label><label>Discount %<input ref={discountRef} type="number" min="0" max="100" step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /></label><button type="button" className="gold-btn add-item" onClick={add}>＋ Add</button></div></div><div className="panel table-panel bill-grid"><table><thead><tr><th>S.No</th><th>Book</th><th>Price</th><th>Qty</th><th>Gross</th><th>Disc</th><th>Total</th><th>Del</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.bookId}><td>{index + 1}</td><td>{item.bookTitle}</td><td>{money(item.price)}</td><td>{item.quantity}</td><td>{money(item.gross)}</td><td>{item.discountPercent}%</td><td>{money(item.total)}</td><td><button className="danger" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></td></tr>)}<tr className="total-row"><td colSpan={6}>TOTAL</td><td>{money(total)}</td><td /></tr></tbody></table></div><div className="bill-save"><button disabled={saving || !pdfReady} className="gold-btn" onClick={() => void submit()}>{!pdfReady ? "Preparing PDF..." : saving ? "Saving Bill..." : initial ? "Update & Print Bill" : "Save & Print Bill"}</button></div></>;
}

function Invoices({ bills, onEdit, onRefund, onDeleteMany }: { bills: Bill[]; onEdit: (bill: Bill) => void; onRefund: (bill: Bill) => Promise<void>; onDeleteMany: (ids: string[]) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const table = useTableState(bills, query, "invoices");
  const confirmDelete = async () => { if (!table.pending?.length) return; table.setDeleting(true); try { await onDeleteMany(table.pending); table.setSelected([]); } finally { table.setDeleting(false); table.setPending(null); } };
  return <><div className="page-header"><h1>All Invoices</h1></div><div className="toolbar"><div className="toolbar-actions">{table.selected.length > 0 && <button className="btn-delete-selected" onClick={() => table.setPending(table.selected)}>⌫ Delete ({table.selected.length})</button>}</div><input placeholder="Search by bill no, customer, salesman..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="panel table-panel"><table><thead><tr><th className="select-col"><input type="checkbox" className="select-checkbox" checked={table.allSelected} ref={(element) => { if (element) element.indeterminate = table.selected.length > 0 && !table.allSelected; }} onChange={table.toggleAll} /></th><th>Bill No</th><th>Customer</th><th>Salesman</th><th>Total</th><th>Date</th><th>Actions</th></tr></thead><tbody>{table.pageRows.map((bill) => <tr key={bill._id}><td className="select-col"><input type="checkbox" className="select-checkbox" checked={table.selected.includes(bill._id)} onChange={() => table.toggleRow(bill._id)} /></td><td>{bill.billNo}</td><td>{bill.customerName}</td><td>{bill.salesmanName}</td><td>{money(bill.totalAmount)}</td><td>{new Date(bill.createdAt).toLocaleDateString()}</td><td className="actions"><button onClick={() => onEdit(bill)}>✎</button><button onClick={() => void onRefund(bill)}>↶</button><button className="danger" onClick={() => table.setPending([bill._id])}>⌫</button></td></tr>)}{!table.pageRows.length && <tr><td colSpan={7} className="empty">No invoices found</td></tr>}</tbody></table><Pagination page={table.page} totalPages={table.totalPages} total={table.filtered.length} onChange={table.setPage} /></div>{table.pending && <ConfirmDialog count={table.pending.length} label={table.pending.length === 1 ? "invoice" : "invoices"} busy={table.deleting} onCancel={() => table.setPending(null)} onConfirm={() => void confirmDelete()} />}</>;
}
