const tabs = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Sales" },
  { id: "cashiers", label: "Cashiers" },
  { id: "products", label: "Products" },
  { id: "inventory", label: "Inventory" },
  { id: "settings", label: "Settings" },
];

export default function TabBar({ activeTab, onChange }) {
  return (
    <nav className="tabbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === activeTab ? "tab active" : "tab"}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
