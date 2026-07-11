// Self-contained mock data so dashboard.html renders without the backend.
// Swap for a real fetch later: replace getDashboardData() body with
// `return (await fetch('/api/dashboard')).json();`
async function getDashboardData() {
  const categories = ["Electronics", "Home & Kitchen", "Apparel", "Sports", "Toys", "Beauty"];
  const regions = ["North", "South", "East", "West", "Central"];
  const warehouses = ["WH-North", "WH-South", "WH-East", "WH-West"];

  const months = [];
  const now = new Date(2026, 5, 20);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toLocaleString("en-US", { month: "short" }));
  }

  const seasonalMultiplier = (idx) => {
    // index 11 is current month (Jun), wrap back for Nov/Dec bump
    const monthIdx = (now.getMonth() - (11 - idx) + 12) % 12;
    if (monthIdx === 10 || monthIdx === 11) return 1.55;
    if (monthIdx === 7 || monthIdx === 8) return 1.25;
    return 1.0;
  };

  const revenueTrend = months.map((m, i) => ({
    month: m,
    revenue: Math.round((38000 + i * 1400) * seasonalMultiplier(i) * (0.92 + Math.random() * 0.16)),
  }));

  const topProducts = [
    "Financial", "Outside", "Discover Apparel", "Public Electronic",
    "May Toy", "Show Electronic",
  ].map((name) => ({ name, revenue: Math.round(8000 + Math.random() * 22000) }))
    .sort((a, b) => b.revenue - a.revenue);

  const ordersByRegion = regions.map((region) => ({
    region,
    orders: Math.round(280 + Math.random() * 520),
  }));

  const stockByWarehouse = warehouses.map((wh, i) => ({
    warehouse: wh,
    stock: i === 1 ? Math.round(15 + Math.random() * 30) : Math.round(180 + Math.random() * 420),
  }));

  const totalRevenue = revenueTrend.reduce((s, r) => s + r.revenue, 0);
  const ordersCompleted = ordersByRegion.reduce((s, r) => s + r.orders, 0);
  const returnRate = 11.8;
  const lowStockCount = stockByWarehouse.filter((w) => w.stock < 50).length + 6;

  // Small trend series for each KPI's inline sparkline (last 8 points, not
  // tied to the main 12-month chart — just a quick visual trend cue).
  const spark = (base, volatility, points = 8) => {
    const out = [base];
    for (let i = 1; i < points; i++) {
      const drift = (Math.random() - 0.35) * volatility;
      out.push(Math.max(0, out[i - 1] + drift));
    }
    return out;
  };

  return {
    kpis: {
      totalRevenue,
      ordersCompleted,
      returnRate,
      lowStockCount,
      revenueTrendDelta: 18.6,
      ordersTrendDelta: 12.4,
      returnsTrendDelta: -2.1,
      lowStockTrendDelta: 9.0,
      revenueSpark: spark(70, 14),
      ordersSpark: spark(60, 12),
      returnsSpark: spark(50, 6),
      lowStockSpark: spark(40, 10),
    },
    revenueTrend,
    topProducts,
    ordersByRegion,
    stockByWarehouse,
    categories,
  };
}
