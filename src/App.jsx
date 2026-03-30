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
  storeId: "retailpos_mobile_store_id",
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
    const items = Array.isArray(sale.items_json) ? sale.items_json : [];

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

function buildOverviewSummary(summary, salesRows) {
  const refundsCount = salesRows.filter((sale) => normalizeSaleType(sale.sale_type) === "refund").length;
  return {
    transactions: safeNumber(summary?.transactions),
    revenue: safeNumber(summary?.revenue),
    gross_profit: safeNumber(summary?.gross_profit),
    refunds: safeNumber(summary?.refunds),
    refundsCount,
    items_sold: safeNumber(summary?.items_sold),
    low_stock_count: safeNumber(summary?.low_stock_count),
    topCashier: summary?.top_cashier?.cashier_name || "-",
    topProduct: summary?.top_product?.product_name || "-",
  };
}

function summarizeInventory(rows) {
  return {
    products: rows.length,
    units: rows.reduce((acc, item) => acc + safeNumber(item.stock), 0),
    stockValue: rows.reduce((acc, item) => acc + safeNumber(item.stock) * safeNumber(item.cost || item.price), 0),
    lowStock: rows.filter((item) => safeNumber(item.stock) <= safeNumber(item.low_stock_threshold || 5)).length,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [storeId, setStoreId] = useState(() => localStorage.getItem(STORAGE_KEYS.storeId) || import.meta.env.VITE_DEFAULT_STORE_ID || "store_1");
  const [rangeId, setRangeId] = useState(() => localStorage.getItem(STORAGE_KEYS.range) || "30d");
  const [currency, setCurrency] = useState(() => localStorage.getItem(STORAGE_KEYS.currency) || "BDT");
  const [inventorySearch, setInventorySearch] = useState(() => localStorage.getItem(STORAGE_KEYS.inventorySearch) || "");
  const [inventorySort, setInventorySort] = useState(() => localStorage.getItem(STORAGE_KEYS.inventorySort) || "name");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [cashiers, setCashiers] = useState([]);
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [salesRows, setSalesRows] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);

  const { from, to } = useMemo(() => getRangeBounds(rangeId), [rangeId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.storeId, storeId);
  }, [storeId]);

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

  const loadData = useCallback(async () => {
    setError("");
    setSuccess("");

    if (!hasSupabaseEnv || !supabase) {
      setError("Supabase URL or anon key is missing. Add them to .env.local first.");
      return;
    }

    if (!storeId.trim()) {
      setError("Enter a Store ID first.");
      return;
    }

    setLoading(true);

    try {
      const cleanStoreId = storeId.trim();
      const summaryRequest = supabase.rpc("get_store_summary", {
        p_store_id: cleanStoreId,
        p_from: from ? from.toISOString() : null,
        p_to: to ? to.toISOString() : null,
      });

      let dailyRequest = supabase
        .from("v_sales_daily")
        .select("*")
        .eq("store_id", cleanStoreId)
        .order("day", { ascending: true });

      let monthlyRequest = supabase
        .from("v_sales_monthly")
        .select("*")
        .eq("store_id", cleanStoreId)
        .order("month", { ascending: true });

      let salesRequest = supabase
        .from("sales")
        .select("cashier_name,total,gross_profit,sale_type,status,created_at,items_json")
        .eq("store_id", cleanStoreId)
        .order("created_at", { ascending: false })
        .limit(rangeId === "all" ? 5000 : 1000);

      const lowStockRequest = supabase
        .from("v_low_stock")
        .select("*")
        .eq("store_id", cleanStoreId)
        .order("stock", { ascending: true })
        .limit(30);

      const inventoryRequest = supabase
        .from("inventory")
        .select("store_id,product_id,product_name,sku,category,price,cost,stock,low_stock_threshold,barcode,updated_at")
        .eq("store_id", cleanStoreId)
        .order("product_name", { ascending: true })
        .limit(2000);

      if (from) {
        const fromDate = toDateOnlyString(from);
        dailyRequest = dailyRequest.gte("day", fromDate);
        monthlyRequest = monthlyRequest.gte("month", fromDate);
        salesRequest = salesRequest.gte("created_at", from.toISOString());
      }

      if (to) {
        const toDate = toDateOnlyString(to);
        dailyRequest = dailyRequest.lte("day", toDate);
        monthlyRequest = monthlyRequest.lte("month", toDate);
        salesRequest = salesRequest.lte("created_at", to.toISOString());
      }

      const [summaryRes, dailyRes, monthlyRes, salesRes, lowStockRes, inventoryRes] = await Promise.all([
        summaryRequest,
        dailyRequest,
        monthlyRequest,
        salesRequest,
        lowStockRequest,
        inventoryRequest,
      ]);

      const firstError = summaryRes.error || dailyRes.error || monthlyRes.error || salesRes.error || lowStockRes.error || inventoryRes.error;
      if (firstError) throw firstError;

      const salesData = Array.isArray(salesRes.data) ? salesRes.data : [];

      setSummary(summaryRes.data || {});
      setDaily(Array.isArray(dailyRes.data) ? dailyRes.data : []);
      setMonthly(Array.isArray(monthlyRes.data) ? monthlyRes.data : []);
      setLowStock(Array.isArray(lowStockRes.data) ? lowStockRes.data : []);
      setInventoryRows(Array.isArray(inventoryRes.data) ? inventoryRes.data : []);
      setSalesRows(salesData);
      setCashiers(aggregateCashiers(salesData));
      setProducts(aggregateProducts(salesData));
      setSuccess("Dashboard updated.");
    } catch (err) {
      setError(err?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, rangeId, storeId, to]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const overview = useMemo(() => buildOverviewSummary(summary, salesRows), [summary, salesRows]);
  const inventorySummary = useMemo(() => summarizeInventory(inventoryRows), [inventoryRows]);

  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    let rows = [...inventoryRows];

    if (q) {
      rows = rows.filter((item) => {
        const haystack = [
          item.product_name,
          item.sku,
          item.category,
          item.barcode,
        ]
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

  const money = useCallback((value) => formatMoney(value, currency), [currency]);

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
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 12,
                  }}
                />
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
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 12,
                  }}
                />
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
          <div className="list-item">
            <div>
              <h3>Total revenue</h3>
              <p>Gross sales excluding refund rows</p>
            </div>
            <div className="list-amount">{money(overview.revenue)}</div>
          </div>
          <div className="list-item">
            <div>
              <h3>Total profit</h3>
              <p>Based on synced gross profit</p>
            </div>
            <div className="list-amount">{money(overview.gross_profit)}</div>
          </div>
          <div className="list-item">
            <div>
              <h3>Refund amount</h3>
              <p>{overview.refundsCount} refund receipts</p>
            </div>
            <div className="list-amount">{money(overview.refunds)}</div>
          </div>
          <div className="list-item">
            <div>
              <h3>Transactions</h3>
              <p>Completed and due sales in range</p>
            </div>
            <div className="list-amount">{overview.transactions}</div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Recent sales records" subtitle="This list is based on the synced sales rows.">
        {salesRows.length ? (
          <div className="list">
            {salesRows.slice(0, 12).map((sale, index) => (
              <div className="list-item" key={`${sale.created_at}-${index}`}>
                <div>
                  <h3>{normalizeSaleType(sale.sale_type) === "refund" ? "Refund" : "Sale"}</h3>
                  <p>
                    {sale.cashier_name || "Unknown cashier"} • {new Date(sale.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="list-amount">{money(Math.abs(safeNumber(sale.total)))}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No sales found for this range.</div>
        )}
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
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148,163,184,0.18)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="revenue" fill="#34d399" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">No cashier data found.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Cashier breakdown" subtitle="Revenue, refunds, transactions, and profit.">
        {cashiers.length ? (
          <div className="list">
            {cashiers.map((cashier) => (
              <div className="list-item" key={cashier.cashier_name}>
                <div>
                  <h3>{cashier.cashier_name}</h3>
                  <p>
                    {cashier.transactions} transactions • Refunds {money(cashier.refunds)}
                  </p>
                </div>
                <div className="list-amount">
                  <div>{money(cashier.revenue)}</div>
                  <p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                    Profit {money(cashier.gross_profit)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No cashier data found.</div>
        )}
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
                <div>
                  <h3>{product.product_name}</h3>
                  <p>Qty sold {product.qty_sold}</p>
                </div>
                <div className="list-amount">
                  <div>{money(product.revenue)}</div>
                  <p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                    Profit {money(product.gross_profit)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No product sales data found.</div>
        )}
      </SectionCard>

      <SectionCard title="Low stock" subtitle="Directly from the Supabase low-stock view.">
        {lowStock.length ? (
          <div className="list">
            {lowStock.map((item) => (
              <div className="list-item" key={`${item.store_id}-${item.product_id}`}>
                <div>
                  <h3>{item.product_name}</h3>
                  <p>{item.category || "Uncategorized"}</p>
                </div>
                <div className="list-amount">
                  <div>{item.stock}</div>
                  <p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                    Threshold {item.low_stock_threshold}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No low stock items.</div>
        )}
      </SectionCard>

      <SectionCard title="Inventory snapshot" subtitle="Live stock with selling price and cost.">
        {inventoryRows.length ? (
          <div className="list">
            {inventoryRows.slice(0, 8).map((item) => (
              <div className="list-item" key={`${item.store_id}-${item.product_id}`}>
                <div>
                  <h3>{item.product_name}</h3>
                  <p>{item.category || "Uncategorized"}</p>
                </div>
                <div className="list-amount">
                  <div>{money(item.price)}</div>
                  <p style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                    Stock {item.stock}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No inventory rows found.</div>
        )}
      </SectionCard>
    </>
  );

  const renderInventoryTab = () => (
    <>
      <div className="stats-grid">
        <StatCard title="Products" value={inventorySummary.products} hint="Rows in Supabase inventory" />
        <StatCard title="Stock units" value={inventorySummary.units} hint="Total units on hand" />
        <StatCard title="Stock value" value={money(inventorySummary.stockValue)} hint="Using cost if available" />
        <StatCard title="Low stock" value={inventorySummary.lowStock} hint="Based on threshold" />
      </div>

      <SectionCard
        title="Inventory and price"
        subtitle="Search by product name, SKU, category, or barcode."
        actions={
          <div className="inline-actions">
            <button type="button" className="btn btn-ghost" onClick={loadData} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      >
        <div className="inventory-toolbar">
          <div className="field">
            <label htmlFor="inventory-search">Search inventory</label>
            <input
              id="inventory-search"
              value={inventorySearch}
              onChange={(event) => setInventorySearch(event.target.value)}
              placeholder="Search product, SKU, category, barcode"
            />
          </div>
          <div className="field">
            <label htmlFor="inventory-sort">Inventory sort</label>
            <select id="inventory-sort" value={inventorySort} onChange={(event) => setInventorySort(event.target.value)}>
              {INVENTORY_SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
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
                    <span className={isLow ? "low-stock-badge" : "ok-stock-badge"}>
                      {isLow ? "Low stock" : "In stock"}
                    </span>
                  </div>

                  <div className="inventory-numbers">
                    <div className="mini-stat">
                      <div className="mini-stat-label">Selling price</div>
                      <div className="mini-stat-value">{money(item.price)}</div>
                    </div>
                    <div className="mini-stat">
                      <div className="mini-stat-label">Cost</div>
                      <div className="mini-stat-value">{money(item.cost)}</div>
                    </div>
                    <div className="mini-stat">
                      <div className="mini-stat-label">Stock</div>
                      <div className="mini-stat-value">{safeNumber(item.stock)}</div>
                    </div>
                    <div className="mini-stat">
                      <div className="mini-stat-label">Threshold</div>
                      <div className="mini-stat-value">{safeNumber(item.low_stock_threshold || 5)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="inventory-empty">No inventory rows found for this store.</div>
        )}
      </SectionCard>
    </>
  );

  const renderSettingsTab = () => (
    <SectionCard title="Dashboard settings" subtitle="Change the store and refresh the dashboard.">
      <div className="settings-box">
        <div className="field">
          <label htmlFor="storeId">Store ID</label>
          <input
            id="storeId"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            placeholder="store_1"
          />
        </div>

        <div className="field">
          <label htmlFor="range">Range</label>
          <select id="range" value={rangeId} onChange={(event) => setRangeId(event.target.value)}>
            {RANGE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="currency">Currency</label>
          <select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="BDT">BDT (৳)</option>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </div>

        <div className="inline-actions">
          <button type="button" className="btn btn-primary" onClick={loadData} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh now"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEYS.storeId);
              localStorage.removeItem(STORAGE_KEYS.range);
              localStorage.removeItem(STORAGE_KEYS.currency);
              localStorage.removeItem(STORAGE_KEYS.inventorySearch);
              localStorage.removeItem(STORAGE_KEYS.inventorySort);
              setStoreId(import.meta.env.VITE_DEFAULT_STORE_ID || "store_1");
              setRangeId("30d");
              setCurrency("BDT");
              setInventorySearch("");
              setInventorySort("name");
              setSuccess("Saved settings cleared on this phone.");
            }}
          >
            Reset saved values
          </button>
        </div>

        <div className="help-text">
          <div>Put your Supabase values in <code>.env.local</code>.</div>
          <div>This phone app reads Supabase directly. It does not connect to Electron or SQLite.</div>
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="app-shell">
      <div className="container">
        <header className="page-header">
          <div className="page-title">
            <h1>RetailPOS Mobile</h1>
            <span className="badge">{storeId || "No store"}</span>
          </div>
          <p className="page-subtitle">Phone dashboard for your synced Supabase data.</p>
        </header>

        <div className="card toolbar">
          <div className="toolbar-grid">
            <div className="field">
              <label htmlFor="quick-store">Store ID</label>
              <input
                id="quick-store"
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                placeholder="store_1"
              />
            </div>
            <div className="field">
              <label htmlFor="quick-range">Range</label>
              <select id="quick-range" value={rangeId} onChange={(event) => setRangeId(event.target.value)}>
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-primary" onClick={loadData} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
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
