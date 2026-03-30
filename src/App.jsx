import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import LoginScreen from "./components/LoginScreen";
import SectionCard from "./components/SectionCard";
import StatCard from "./components/StatCard";
import TabBar from "./components/TabBar";
import { hasSupabaseEnv, supabase } from "./lib/supabase";

const RANGE_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

const INVENTORY_SORT_OPTIONS = [
  { id: "name", label: "Sort: Name" },
  { id: "stockAsc", label: "Sort: Stock low → high" },
  { id: "stockDesc", label: "Sort: Stock high → low" },
  { id: "priceAsc", label: "Sort: Price low → high" },
  { id: "priceDesc", label: "Sort: Price high → low" },
];

const STORAGE_KEYS = {
  range: "retailpos_mobile_range",
  currency: "retailpos_mobile_currency",
  inventorySearch: "retailpos_mobile_inventory_search",
  inventorySort: "retailpos_mobile_inventory_sort",
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDateOnlyString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date) {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function endOfDay(date) {
  const clone = new Date(date);
  clone.setHours(23, 59, 59, 999);
  return clone;
}

function getRangeBounds(rangeId) {
  const now = new Date();
  const end = endOfDay(now);
  const start = startOfDay(now);

  switch (rangeId) {
    case "today":
      return { from: start, to: end };
    case "7d": {
      const from = new Date(start);
      from.setDate(from.getDate() - 6);
      return { from, to: end };
    }
    case "30d": {
      const from = new Date(start);
      from.setDate(from.getDate() - 29);
      return { from, to: end };
    }
    case "90d": {
      const from = new Date(start);
      from.setDate(from.getDate() - 89);
      return { from, to: end };
    }
    case "year": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(from), to: end };
    }
    default:
      return { from: null, to: null };
  }
}

function safeNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value, currency = "BDT") {
  const num = safeNumber(value);
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "৳";
  return `${symbol}${num.toFixed(2)}`;
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatMonth(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function normalizeStatus(status) {
  return String(status || "completed").toLowerCase();
}

function normalizeSaleType(type) {
  return String(type || "sale").toLowerCase();
}

function normalizeItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function aggregateCashiers(rows) {
  const map = new Map();

  for (const sale of rows) {
    const key = String(sale.cashier_name || "Unknown").trim() || "Unknown";
    const current = map.get(key) || {
      cashier_name: key,
      transactions: 0,
      revenue: 0,
      refunds: 0,
      gross_profit: 0,
    };

    const total = safeNumber(sale.total);
    const profit = safeNumber(sale.gross_profit);
    const type = normalizeSaleType(sale.sale_type);
    const status = normalizeStatus(sale.status);

    if (status === "completed" || status === "due") current.transactions += 1;

    if (type === "refund") {
      current.refunds += Math.abs(total);
    } else {
      current.revenue += total;
    }

    current.gross_profit += profit;
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

function aggregateProducts(rows) {
  const map = new Map();

  for (const sale of rows) {
    if (normalizeSaleType(sale.sale_type) === "refund") continue;
    const items = normalizeItems(sale.items_json);

    for (const item of items) {
      const name = String(item.product_name || item.name || "Unknown").trim() || "Unknown";
      const current = map.get(name) || {
        product_name: name,
        qty_sold: 0,
        revenue: 0,
        gross_profit: 0,
      };

      current.qty_sold += safeNumber(item.quantity);
      current.revenue += safeNumber(item.subtotal);
      current.gross_profit += safeNumber(item.profit);
      map.set(name, current);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

function aggregateDaily(rows) {
  const map = new Map();

  for (const sale of rows) {
    const createdAt = sale.created_at ? new Date(sale.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;

    const day = toDateOnlyString(createdAt);
    const current = map.get(day) || {
      day,
      transactions: 0,
      revenue: 0,
      refunds: 0,
      gross_profit: 0,
    };

    const type = normalizeSaleType(sale.sale_type);
    const status = normalizeStatus(sale.status);
    const total = safeNumber(sale.total);
    const profit = safeNumber(sale.gross_profit);

    if (status === "completed" || status === "due") current.transactions += 1;
    if (type === "refund") current.refunds += Math.abs(total);
    else current.revenue += total;
    current.gross_profit += profit;

    map.set(day, current);
  }

  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function aggregateMonthly(rows) {
  const map = new Map();

  for (const sale of rows) {
    const createdAt = sale.created_at ? new Date(sale.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;

    const month = `${createdAt.getFullYear()}-${pad2(createdAt.getMonth() + 1)}-01`;
    const current = map.get(month) || {
      month,
      transactions: 0,
      revenue: 0,
      refunds: 0,
      gross_profit: 0,
    };

    const type = normalizeSaleType(sale.sale_type);
    const status = normalizeStatus(sale.status);
    const total = safeNumber(sale.total);
    const profit = safeNumber(sale.gross_profit);

    if (status === "completed" || status === "due") current.transactions += 1;
    if (type === "refund") current.refunds += Math.abs(total);
    else current.revenue += total;
    current.gross_profit += profit;

    map.set(month, current);
  }

  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function summarizeInventory(rows) {
  return {
    products: rows.length,
    units: rows.reduce((acc, item) => acc + safeNumber(item.stock), 0),
    stockValue: rows.reduce((acc, item) => acc + safeNumber(item.stock) * safeNumber(item.cost || item.price), 0),
    lowStock: rows.filter((item) => safeNumber(item.stock) <= safeNumber(item.low_stock_threshold || 5)).length,
  };
}

function buildOverviewSummary(rows, inventoryRows) {
  const refundsCount = rows.filter((sale) => normalizeSaleType(sale.sale_type) === "refund").length;
  const revenue = rows.reduce((acc, sale) => (normalizeSaleType(sale.sale_type) === "refund" ? acc : acc + safeNumber(sale.total)), 0);
  const refunds = rows.reduce((acc, sale) => (normalizeSaleType(sale.sale_type) === "refund" ? acc + Math.abs(safeNumber(sale.total)) : acc), 0);
  const grossProfit = rows.reduce((acc, sale) => acc + safeNumber(sale.gross_profit), 0);
  const transactions = rows.reduce((acc, sale) => ((normalizeStatus(sale.status) === "completed" || normalizeStatus(sale.status) === "due") ? acc + 1 : acc), 0);
  const itemsSold = rows.reduce((acc, sale) => {
    if (normalizeSaleType(sale.sale_type) === "refund") return acc;
    if (sale.items_count !== undefined && sale.items_count !== null) return acc + safeNumber(sale.items_count);
    return acc + normalizeItems(sale.items_json).reduce((sum, item) => sum + safeNumber(item.quantity), 0);
  }, 0);
  const lowStockCount = inventoryRows.filter((item) => safeNumber(item.stock) <= safeNumber(item.low_stock_threshold || 5)).length;
  const cashiers = aggregateCashiers(rows);
  const products = aggregateProducts(rows);

  return {
    transactions,
    revenue,
    gross_profit: grossProfit,
    refunds,
    refundsCount,
    items_sold: itemsSold,
    low_stock_count: lowStockCount,
    topCashier: cashiers[0]?.cashier_name || "-",
    topProduct: products[0]?.product_name || "-",
  };
}

function getSavedActiveStoreKey(userId) {
  return `retailpos_mobile_store_id_${userId}`;
}

function Dashboard({ session }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [rangeId, setRangeId] = useState(() => localStorage.getItem(STORAGE_KEYS.range) || "30d");
  const [currency, setCurrency] = useState(() => localStorage.getItem(STORAGE_KEYS.currency) || "BDT");
  const [inventorySearch, setInventorySearch] = useState(() => localStorage.getItem(STORAGE_KEYS.inventorySearch) || "");
  const [inventorySort, setInventorySort] = useState(() => localStorage.getItem(STORAGE_KEYS.inventorySort) || "name");

  const [loading, setLoading] = useState(false);
  const [storesLoading, setStoresLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [stores, setStores] = useState([]);
  const [profile, setProfile] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [salesRows, setSalesRows] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);

  const { from, to } = useMemo(() => getRangeBounds(rangeId), [rangeId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.range, rangeId);
  }, [rangeId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.currency, currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.inventorySearch, inventorySearch);
  }, [inventorySearch]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.inventorySort, inventorySort);
  }, [inventorySort]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!storeId) return;
    localStorage.setItem(getSavedActiveStoreKey(session.user.id), storeId);
  }, [session?.user?.id, storeId]);

  const loadStores = useCallback(async () => {
    if (!session?.user?.id) return;
    setStoresLoading(true);
    setError("");

    try {
      const userId = session.user.id;
      const [profileRes, userStoresRes] = await Promise.all([
        supabase.from("profiles").select("full_name,default_store_id").eq("id", userId).maybeSingle(),
        supabase.from("user_stores").select("store_id, role").eq("user_id", userId),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (userStoresRes.error) throw userStoresRes.error;

      const links = Array.isArray(userStoresRes.data) ? userStoresRes.data : [];
      const storeIds = links.map((row) => row.store_id).filter(Boolean);

      let storeRows = [];
      if (storeIds.length) {
        const storesRes = await supabase
          .from("stores")
          .select("store_id,store_name,currency")
          .in("store_id", storeIds)
          .order("store_name", { ascending: true });
        if (storesRes.error) throw storesRes.error;
        storeRows = Array.isArray(storesRes.data) ? storesRes.data : [];
      }

      const merged = storeRows.map((store) => {
        const link = links.find((row) => row.store_id === store.store_id);
        return {
          ...store,
          role: link?.role || "viewer",
        };
      });

      setProfile(profileRes.data || null);
      setStores(merged);

      const saved = localStorage.getItem(getSavedActiveStoreKey(userId));
      const defaultCandidates = [
        saved,
        profileRes.data?.default_store_id,
        import.meta.env.VITE_DEFAULT_STORE_ID,
        merged[0]?.store_id,
      ].filter(Boolean);

      const nextStoreId = defaultCandidates.find((candidate) => merged.some((store) => store.store_id === candidate)) || "";
      setStoreId((prev) => (prev && merged.some((store) => store.store_id === prev) ? prev : nextStoreId));
      if (!merged.length) {
        setSuccess("");
        setError("This account has no stores assigned yet.");
      }
    } catch (err) {
      setError(err?.message || "Failed to load your stores.");
    } finally {
      setStoresLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!hasSupabaseEnv || !supabase) {
      setError("Supabase URL or anon key is missing. Add them to .env.local first.");
      return;
    }
    if (!session?.user?.id) return;
    loadStores();
  }, [loadStores, session?.user?.id]);

  const loadData = useCallback(async () => {
    setError("");
    setSuccess("");

    if (!hasSupabaseEnv || !supabase) {
      setError("Supabase URL or anon key is missing. Add them to .env.local first.");
      return;
    }

    if (!storeId.trim()) {
      setError("No active store selected.");
      return;
    }

    setLoading(true);

    try {
      const cleanStoreId = storeId.trim();
      let salesRequest = supabase
        .from("sales")
        .select("id,cashier_name,total,gross_profit,sale_type,status,created_at,items_json,items_count")
        .eq("store_id", cleanStoreId)
        .order("created_at", { ascending: false })
        .limit(rangeId === "all" ? 5000 : 1000);

      const inventoryRequest = supabase
        .from("inventory")
        .select("store_id,product_id,product_name,sku,category,price,cost,stock,low_stock_threshold,barcode,updated_at")
        .eq("store_id", cleanStoreId)
        .order("product_name", { ascending: true })
        .limit(2000);

      if (from) salesRequest = salesRequest.gte("created_at", from.toISOString());
      if (to) salesRequest = salesRequest.lte("created_at", to.toISOString());

      const [salesRes, inventoryRes] = await Promise.all([salesRequest, inventoryRequest]);
      const firstError = salesRes.error || inventoryRes.error;
      if (firstError) throw firstError;

      setSalesRows(Array.isArray(salesRes.data) ? salesRes.data : []);
      setInventoryRows(Array.isArray(inventoryRes.data) ? inventoryRes.data : []);
      setSuccess("Dashboard updated.");
    } catch (err) {
      setError(err?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, rangeId, storeId, to]);

  useEffect(() => {
    if (!storeId) return;
    loadData();
  }, [loadData, storeId]);

  const activeStore = useMemo(() => stores.find((store) => store.store_id === storeId) || null, [stores, storeId]);
  const daily = useMemo(() => aggregateDaily(salesRows), [salesRows]);
  const monthly = useMemo(() => aggregateMonthly(salesRows), [salesRows]);
  const cashiers = useMemo(() => aggregateCashiers(salesRows), [salesRows]);
  const products = useMemo(() => aggregateProducts(salesRows), [salesRows]);
  const lowStock = useMemo(
    () => inventoryRows.filter((item) => safeNumber(item.stock) <= safeNumber(item.low_stock_threshold || 5)),
    [inventoryRows]
  );
  const overview = useMemo(() => buildOverviewSummary(salesRows, inventoryRows), [salesRows, inventoryRows]);
  const inventorySummary = useMemo(() => summarizeInventory(inventoryRows), [inventoryRows]);

  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    let rows = [...inventoryRows];

    if (q) {
      rows = rows.filter((item) => {
        const haystack = [item.product_name, item.sku, item.category, item.barcode]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    rows.sort((a, b) => {
      if (inventorySort === "stockAsc") return safeNumber(a.stock) - safeNumber(b.stock);
      if (inventorySort === "stockDesc") return safeNumber(b.stock) - safeNumber(a.stock);
      if (inventorySort === "priceAsc") return safeNumber(a.price) - safeNumber(b.price);
      if (inventorySort === "priceDesc") return safeNumber(b.price) - safeNumber(a.price);
      return String(a.product_name || "").localeCompare(String(b.product_name || ""));
    });

    return rows;
  }, [inventoryRows, inventorySearch, inventorySort]);

  const money = useCallback((value) => formatMoney(value, activeStore?.currency || currency), [activeStore?.currency, currency]);

  async function handleSignOut() {
    setError("");
    setSuccess("");
    await supabase.auth.signOut();
  }

  const renderOverviewTab = () => (
    <>
      <div className="stats-grid">
        <StatCard title="Revenue" value={money(overview.revenue)} hint={`${overview.transactions} transactions`} />
        <StatCard title="Profit" value={money(overview.gross_profit)} hint={`Items sold: ${overview.items_sold}`} />
        <StatCard title="Refunds" value={money(overview.refunds)} hint={`${overview.refundsCount} refund receipts`} />
        <StatCard title="Low stock" value={overview.low_stock_count} hint={`Top cashier: ${overview.topCashier}`} />
      </div>

      <SectionCard title="Daily sales" subtitle="Revenue and profit trend for the selected range.">
        <div className="chart-wrap">
          {daily.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.16)" />
                <XAxis dataKey="day" tickFormatter={formatShortDate} stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.18)", borderRadius: 12 }} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#60a5fa" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="gross_profit" name="Profit" stroke="#34d399" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">No daily data found.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Monthly sales" subtitle="Useful for yearly trend checking.">
        <div className="chart-wrap">
          {monthly.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.16)" />
                <XAxis dataKey="month" tickFormatter={formatMonth} stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.18)", borderRadius: 12 }} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                <Bar dataKey="gross_profit" name="Profit" fill="#34d399" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">No monthly data found.</div>
          )}
        </div>
      </SectionCard>
    </>
  );

  const renderSalesTab = () => (
    <>
      <SectionCard title="Sales summary" subtitle="Fast owner view for the current range.">
        <div className="list">
          <div className="list-item"><div><h3>Total revenue</h3><p>Gross sales excluding refund rows</p></div><div className="list-amount">{money(overview.revenue)}</div></div>
          <div className="list-item"><div><h3>Total profit</h3><p>Based on synced gross profit</p></div><div className="list-amount">{money(overview.gross_profit)}</div></div>
          <div className="list-item"><div><h3>Refund amount</h3><p>{overview.refundsCount} refund receipts</p></div><div className="list-amount">{money(overview.refunds)}</div></div>
          <div className="list-item"><div><h3>Transactions</h3><p>Completed and due sales in range</p></div><div className="list-amount">{overview.transactions}</div></div>
        </div>
      </SectionCard>

      <SectionCard title="Recent sales records" subtitle="This list is based on the synced sales rows.">
        {salesRows.length ? (
          <div className="list">
            {salesRows.slice(0, 12).map((sale, index) => (
              <div className="list-item" key={`${sale.id || sale.created_at}-${index}`}>
                <div>
                  <h3>{normalizeSaleType(sale.sale_type) === "refund" ? "Refund" : "Sale"}</h3>
                  <p>{sale.cashier_name || "Unknown cashier"} • {new Date(sale.created_at).toLocaleString()}</p>
                </div>
                <div className="list-amount">{money(Math.abs(safeNumber(sale.total)))}</div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No sales found for this range.</div>}
      </SectionCard>
    </>
  );

  const renderCashiersTab = () => (
    <>
      <SectionCard title="Cashier performance" subtitle="Built from synced sales rows inside the selected range.">
        <div className="chart-wrap">
          {cashiers.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashiers.slice(0, 8)} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.16)" />
                <XAxis type="number" stroke="#94a3b8" />
                <YAxis type="category" dataKey="cashier_name" stroke="#94a3b8" width={90} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.18)", borderRadius: 12 }} />
                <Bar dataKey="revenue" fill="#34d399" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">No cashier data found.</div>}
        </div>
      </SectionCard>

      <SectionCard title="Cashier breakdown" subtitle="Revenue, refunds, transactions, and profit.">
        {cashiers.length ? (
          <div className="list">
            {cashiers.map((cashier) => (
              <div className="list-item" key={cashier.cashier_name}>
                <div>
                  <h3>{cashier.cashier_name}</h3>
                  <p>{cashier.transactions} transactions • Refunds {money(cashier.refunds)}</p>
                </div>
                <div className="list-amount"><div>{money(cashier.revenue)}</div><p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Profit {money(cashier.gross_profit)}</p></div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No cashier data found.</div>}
      </SectionCard>
    </>
  );

  const renderProductsTab = () => (
    <>
      <SectionCard title="Top products" subtitle="Calculated from the synced sale items JSON.">
        {products.length ? (
          <div className="list">
            {products.slice(0, 12).map((product) => (
              <div className="list-item" key={product.product_name}>
                <div><h3>{product.product_name}</h3><p>Qty sold {product.qty_sold}</p></div>
                <div className="list-amount"><div>{money(product.revenue)}</div><p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Profit {money(product.gross_profit)}</p></div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No product sales data found.</div>}
      </SectionCard>

      <SectionCard title="Low stock" subtitle="Directly from synced inventory rows.">
        {lowStock.length ? (
          <div className="list">
            {lowStock.map((item) => (
              <div className="list-item" key={`${item.store_id}-${item.product_id}`}>
                <div><h3>{item.product_name}</h3><p>{item.category || "Uncategorized"}</p></div>
                <div className="list-amount"><div>{item.stock}</div><p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Threshold {item.low_stock_threshold}</p></div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No low stock items.</div>}
      </SectionCard>

      <SectionCard title="Inventory snapshot" subtitle="Live stock with selling price and cost.">
        {inventoryRows.length ? (
          <div className="list">
            {inventoryRows.slice(0, 8).map((item) => (
              <div className="list-item" key={`${item.store_id}-${item.product_id}`}>
                <div><h3>{item.product_name}</h3><p>{item.category || "Uncategorized"}</p></div>
                <div className="list-amount"><div>{money(item.price)}</div><p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Stock {item.stock}</p></div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No inventory rows found.</div>}
      </SectionCard>
    </>
  );

  const renderInventoryTab = () => (
    <>
      <div className="stats-grid">
        <StatCard title="Products" value={inventorySummary.products} hint="Rows in synced inventory" />
        <StatCard title="Stock units" value={inventorySummary.units} hint="Total units on hand" />
        <StatCard title="Stock value" value={money(inventorySummary.stockValue)} hint="Using cost if available" />
        <StatCard title="Low stock" value={inventorySummary.lowStock} hint="Based on threshold" />
      </div>

      <SectionCard title="Inventory and price" subtitle="Search by product name, SKU, category, or barcode." actions={<div className="inline-actions"><button type="button" className="btn btn-ghost" onClick={loadData} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button></div>}>
        <div className="inventory-toolbar">
          <div className="field"><label htmlFor="inventory-search">Search inventory</label><input id="inventory-search" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search product, SKU, category, barcode" /></div>
          <div className="field"><label htmlFor="inventory-sort">Inventory sort</label><select id="inventory-sort" value={inventorySort} onChange={(event) => setInventorySort(event.target.value)}>{INVENTORY_SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
        </div>

        {filteredInventory.length ? (
          <div className="inventory-grid">
            {filteredInventory.map((item) => {
              const isLow = safeNumber(item.stock) <= safeNumber(item.low_stock_threshold || 5);
              return (
                <div className="inventory-card" key={`${item.store_id}-${item.product_id}`}>
                  <div className="inventory-top">
                    <div>
                      <h3 className="inventory-title">{item.product_name}</h3>
                      <div className="inventory-meta">
                        {item.category ? <span className="meta-chip">{item.category}</span> : null}
                        {item.sku ? <span className="meta-chip">SKU {item.sku}</span> : null}
                        {item.barcode ? <span className="meta-chip">Barcode {item.barcode}</span> : null}
                      </div>
                    </div>
                    <span className={isLow ? "low-stock-badge" : "ok-stock-badge"}>{isLow ? "Low stock" : "In stock"}</span>
                  </div>

                  <div className="inventory-numbers">
                    <div className="mini-stat"><div className="mini-stat-label">Selling price</div><div className="mini-stat-value">{money(item.price)}</div></div>
                    <div className="mini-stat"><div className="mini-stat-label">Cost</div><div className="mini-stat-value">{money(item.cost)}</div></div>
                    <div className="mini-stat"><div className="mini-stat-label">Stock</div><div className="mini-stat-value">{safeNumber(item.stock)}</div></div>
                    <div className="mini-stat"><div className="mini-stat-label">Threshold</div><div className="mini-stat-value">{safeNumber(item.low_stock_threshold || 5)}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="inventory-empty">No inventory rows found for this store.</div>}
      </SectionCard>
    </>
  );

  const renderSettingsTab = () => (
    <SectionCard title="Dashboard settings" subtitle="Account and local display settings.">
      <div className="settings-box">
        <div className="field">
          <label htmlFor="store-switcher-settings">Store</label>
          <select id="store-switcher-settings" value={storeId} onChange={(event) => setStoreId(event.target.value)} disabled={!stores.length}>
            {stores.map((store) => <option key={store.store_id} value={store.store_id}>{store.store_name || store.store_id}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="range">Range</label>
          <select id="range" value={rangeId} onChange={(event) => setRangeId(event.target.value)}>
            {RANGE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="currency">Currency override</label>
          <select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="BDT">BDT (৳)</option>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </div>

        <div className="inline-actions">
          <button type="button" className="btn btn-primary" onClick={loadData} disabled={loading}>{loading ? "Refreshing..." : "Refresh now"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => {
            localStorage.removeItem(STORAGE_KEYS.range);
            localStorage.removeItem(STORAGE_KEYS.currency);
            localStorage.removeItem(STORAGE_KEYS.inventorySearch);
            localStorage.removeItem(STORAGE_KEYS.inventorySort);
            if (session?.user?.id) localStorage.removeItem(getSavedActiveStoreKey(session.user.id));
            setRangeId("30d");
            setCurrency(activeStore?.currency || "BDT");
            setInventorySearch("");
            setInventorySort("name");
            setStoreId(profile?.default_store_id && stores.some((store) => store.store_id === profile.default_store_id) ? profile.default_store_id : (stores[0]?.store_id || ""));
            setSuccess("Saved settings cleared on this phone.");
          }}>Reset saved values</button>
        </div>

        <div className="help-text">
          <div>Signed in as <code>{session?.user?.email}</code>.</div>
          <div>For real hard security, the desktop POS sync should eventually move off broad public table policies. This login locks the dashboard UI and store selection.</div>
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="app-shell">
      <div className="container">
        <header className="page-header">
          <div className="page-title">
            <div>
              <h1>RetailPOS Mobile</h1>
              <p className="page-subtitle">{activeStore?.store_name || storeId || "No store selected"}</p>
            </div>
            <span className="badge">{activeStore?.store_id || storeId || "No store"}</span>
          </div>
          <div className="account-row">
            <div className="account-meta">
              <div className="account-user">{profile?.full_name || session?.user?.email || "Signed in"}</div>
              <div className="account-sub">{storesLoading ? "Loading stores..." : `${stores.length} store${stores.length === 1 ? "" : "s"} available`}</div>
            </div>
            <div className="account-actions">
              <select className="store-select" value={storeId} onChange={(event) => setStoreId(event.target.value)} disabled={!stores.length}>
                {stores.map((store) => <option key={store.store_id} value={store.store_id}>{store.store_name || store.store_id}</option>)}
              </select>
              <button type="button" className="btn btn-ghost" onClick={handleSignOut}>Logout</button>
            </div>
          </div>
        </header>

        <div className="card toolbar">
          <div className="toolbar-grid">
            <div className="field">
              <label htmlFor="quick-store">Store</label>
              <select id="quick-store" value={storeId} onChange={(event) => setStoreId(event.target.value)} disabled={!stores.length}>
                {stores.map((store) => <option key={store.store_id} value={store.store_id}>{store.store_name || store.store_id}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="quick-range">Range</label>
              <select id="quick-range" value={rangeId} onChange={(event) => setRangeId(event.target.value)}>
                {RANGE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-primary" onClick={loadData} disabled={loading || !storeId}>{loading ? "Loading..." : "Refresh"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setActiveTab("settings")}>Open settings</button>
          </div>
        </div>

        {error ? <div className="card message error">{error}</div> : null}
        {success && !error ? <div className="card message success">{success}</div> : null}

        {activeTab === "overview" && renderOverviewTab()}
        {activeTab === "sales" && renderSalesTab()}
        {activeTab === "cashiers" && renderCashiersTab()}
        {activeTab === "products" && renderProductsTab()}
        {activeTab === "inventory" && renderInventoryTab()}
        {activeTab === "settings" && renderSettingsTab()}
      </div>

      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!hasSupabaseEnv || !supabase) {
      setSession(null);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (!hasSupabaseEnv || !supabase) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>RetailPOS Mobile</h1>
          <p className="page-subtitle">Add your Supabase URL and anon key to <code>.env.local</code> first.</p>
        </div>
      </div>
    );
  }

  if (session === undefined) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>RetailPOS Mobile</h1>
          <p className="page-subtitle">Checking session...</p>
        </div>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  return <Dashboard session={session} />;
}
