const palette = {
  text: "#f1eee4",
  textMuted: "#a3a7b5",
  grid: "#2e3340",
  amber: "#e08a2c",
  amberBright: "#ffab4d",
  red: "#f0556a",
  redBright: "#ff7d8f",
  revenue: "#4fd1a5",
  revenueBright: "#6ee6bd",
  orders: "#5b9dff",
  ordersBright: "#82b8ff",
  returns: "#c98bf0",
  returnsBright: "#dba8f7",
  series: ["#e08a2c", "#4fd1a5", "#5b9dff", "#c98bf0", "#f0c75e", "#f0556a"],
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const baseAnimation = reduceMotion ? false : { duration: 480, easing: "easeOutQuart" };

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = palette.textMuted;

function fmtCurrency(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtCompact(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function gridOpts() {
  return {
    grid: { color: palette.grid, drawTicks: false },
    border: { display: false },
    ticks: { color: palette.textMuted, font: { size: 11 } },
  };
}

function fmtDelta(n) {
  const sign = n >= 0 ? "↑" : "↓";
  return `${sign} ${Math.abs(n).toFixed(1)}% vs last month`;
}

function renderSparkline(canvasId, series, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  new Chart(canvas, {
    type: "line",
    data: {
      labels: series.map((_, i) => i),
      datasets: [{
        data: series,
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 1.75,
        tension: 0.4,
        pointRadius: 0,
        fill: false,
      }],
    },
    options: {
      responsive: false,
      animation: baseAnimation,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      elements: { line: { borderJoinStyle: "round" } },
    },
  });
}

async function renderDashboard() {
  const data = await getDashboardData();

  document.getElementById("kpi-revenue").textContent = fmtCurrency(data.kpis.totalRevenue);
  document.getElementById("kpi-orders").textContent = data.kpis.ordersCompleted.toLocaleString("en-US");
  document.getElementById("kpi-returns").textContent = data.kpis.returnRate.toFixed(1) + "%";
  document.getElementById("kpi-lowstock").textContent = String(data.kpis.lowStockCount);

  document.getElementById("kpi-revenue-delta").textContent = fmtDelta(data.kpis.revenueTrendDelta);
  document.getElementById("kpi-orders-delta").textContent = fmtDelta(data.kpis.ordersTrendDelta);
  const returnsDeltaEl = document.getElementById("kpi-returns-delta");
  returnsDeltaEl.textContent = fmtDelta(data.kpis.returnsTrendDelta);
  returnsDeltaEl.classList.toggle("down", data.kpis.returnsTrendDelta < 0);
  returnsDeltaEl.classList.toggle("up", data.kpis.returnsTrendDelta >= 0);

  renderSparkline("spark-revenue", data.kpis.revenueSpark, palette.revenueBright);
  renderSparkline("spark-orders", data.kpis.ordersSpark, palette.ordersBright);
  renderSparkline("spark-returns", data.kpis.returnsSpark, palette.returnsBright);

  new Chart(document.getElementById("chart-revenue"), {
    type: "line",
    data: {
      labels: data.revenueTrend.map((d) => d.month),
      datasets: [{
        data: data.revenueTrend.map((d) => d.revenue),
        borderColor: palette.revenueBright,
        backgroundColor: "rgba(79, 209, 165, 0.14)",
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: baseAnimation,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => fmtCurrency(ctx.parsed.y) },
        },
      },
      scales: {
        x: gridOpts(),
        y: { ...gridOpts(), ticks: { ...gridOpts().ticks, callback: (v) => fmtCompact(v) } },
      },
    },
  });

  new Chart(document.getElementById("chart-products"), {
    type: "doughnut",
    data: {
      labels: data.topProducts.map((d) => d.name),
      datasets: [{
        data: data.topProducts.map((d) => d.revenue),
        backgroundColor: data.topProducts.map((_, i) => palette.series[i % palette.series.length]),
        borderColor: "#1a1d26",
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      animation: baseAnimation,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { color: palette.textMuted, font: { size: 10.5 }, boxWidth: 10, padding: 8 },
        },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtCurrency(ctx.parsed)}` } },
      },
    },
  });

  new Chart(document.getElementById("chart-regions"), {
    type: "bar",
    data: {
      labels: data.ordersByRegion.map((d) => d.region),
      datasets: [{
        data: data.ordersByRegion.map((d) => d.orders),
        backgroundColor: palette.orders,
        borderRadius: 4,
        maxBarThickness: 36,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: baseAnimation,
      plugins: { legend: { display: false } },
      scales: { x: gridOpts(), y: gridOpts() },
    },
  });

  new Chart(document.getElementById("chart-stock"), {
    type: "bar",
    data: {
      labels: data.stockByWarehouse.map((d) => d.warehouse),
      datasets: [{
        data: data.stockByWarehouse.map((d) => d.stock),
        backgroundColor: data.stockByWarehouse.map((d) => (d.stock < 50 ? palette.red : palette.returns)),
        borderRadius: 4,
        maxBarThickness: 36,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: baseAnimation,
      plugins: { legend: { display: false } },
      scales: { x: gridOpts(), y: gridOpts() },
    },
  });
}

renderDashboard();

// ---------- Ask bar: inline NL2SQL query from the dashboard ----------

const API_BASE = "http://localhost:8000";
const askForm = document.getElementById("ask-form");
const askInput = document.getElementById("ask-input");
const askResults = document.getElementById("ask-results");
const askMicBtn = document.getElementById("ask-mic-btn");

function escapeHtmlDash(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function askPostQuery(question) {
  try {
    const resp = await fetch(`${API_BASE}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history: [] }),
    });
    if (!resp.ok) {
      const detail = await resp.json().catch(() => ({}));
      return { __error: true, ...(detail.detail || detail) };
    }
    return await resp.json();
  } catch (e) {
    return askMockResponder(question);
  }
}

function askMockResponder(question) {
  const q = question.toLowerCase();
  if (q.includes("low") && q.includes("stock") || q.includes("inventory")) {
    return {
      sql: "SELECT p.name, i.warehouse, i.stock_level FROM inventory i JOIN products p ON i.product_id = p.product_id WHERE i.stock_level < 50 ORDER BY i.stock_level ASC",
      columns: ["name", "warehouse", "stock_level"],
      rows: [["Verve Blender", "WH-South", 12], ["Pulse Earbuds", "WH-East", 18], ["Atlas Hiking Boots", "WH-North", 24]],
      row_count: 3,
      summary: "Three SKU/warehouse pairs are under the 50-unit threshold, with the Verve Blender at WH-South the most urgent at 12 units.",
    };
  }
  if (q.includes("top") && q.includes("product")) {
    return {
      sql: "SELECT p.name, SUM(o.quantity * p.unit_price) AS revenue FROM orders o JOIN products p ON o.product_id = p.product_id WHERE o.status = 'completed' GROUP BY p.name ORDER BY revenue DESC LIMIT 5",
      columns: ["name", "revenue"],
      rows: [["Lumen Desk Lamp", 28412.5], ["Atlas Hiking Boots", 24108.0], ["Verve Blender", 19877.25]],
      row_count: 3,
      summary: "The Lumen Desk Lamp leads by revenue at roughly $28.4k, followed by Atlas Hiking Boots and the Verve Blender.",
    };
  }
  if (q.includes("return")) {
    return {
      sql: "SELECT p.category, ROUND(100.0 * SUM(CASE WHEN o.status = 'returned' THEN 1 ELSE 0 END) / COUNT(*), 2) AS return_rate_pct FROM orders o JOIN products p ON o.product_id = p.product_id GROUP BY p.category ORDER BY return_rate_pct DESC",
      columns: ["category", "return_rate_pct"],
      rows: [["Apparel", 15.2], ["Electronics", 13.8], ["Sports", 11.9]],
      row_count: 3,
      summary: "Apparel has the highest return rate at 15.2%, notably above Electronics and Sports.",
    };
  }
  return {
    sql: "SELECT ROUND(SUM(o.quantity * p.unit_price), 2) AS total_revenue FROM orders o JOIN products p ON o.product_id = p.product_id WHERE o.status = 'completed'",
    columns: ["total_revenue"],
    rows: [[542318.67]],
    row_count: 1,
    summary: "Total revenue from completed orders over the dataset's full 18-month window is $542,318.67.",
  };
}

function renderAskResults(data) {
  askResults.hidden = false;

  if (data.__error) {
    const message = data.error || "That question couldn't be turned into a safe query.";
    const reason = data.reason ? `<p class="ask-error-reason">reason: ${escapeHtmlDash(data.reason)}</p>` : "";
    askResults.innerHTML = `
      <div class="ask-error-block">
        <p class="ask-error-message">${escapeHtmlDash(message)}</p>
        ${reason}
      </div>`;
    return;
  }

  const rows = data.large_result ? data.preview_rows : data.rows;
  const columns = data.large_result ? data.preview_columns : data.columns;
  const shown = (rows || []).slice(0, 8);

  const thead = `<tr>${(columns || []).map((c) => `<th>${escapeHtmlDash(c)}</th>`).join("")}</tr>`;
  const tbody = shown
    .map((r) => `<tr>${r.map((v) => `<td>${escapeHtmlDash(v === null ? "—" : String(v))}</td>`).join("")}</tr>`)
    .join("");

  askResults.innerHTML = `
    <p class="ask-summary">${escapeHtmlDash(data.summary || "")}</p>
    <div class="ask-result-table-wrap">
      <table class="result-table tabular">
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    <a class="ask-full-link" href="chatbot.html">Continue this in full chat &rarr;</a>`;
}

async function submitAskQuestion(question) {
  question = question.trim();
  if (!question) return;
  askInput.value = "";
  askResults.hidden = false;
  askResults.innerHTML = `<div class="ask-loading">Writing query…</div>`;
  const data = await askPostQuery(question);
  renderAskResults(data);
}

askForm.addEventListener("submit", (e) => {
  e.preventDefault();
  submitAskQuestion(askInput.value);
});

document.querySelectorAll(".ask-chips .chip[data-question]").forEach((chip) => {
  chip.addEventListener("click", () => submitAskQuestion(chip.dataset.question));
});

const AskSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (AskSpeechRecognition) {
  askMicBtn.hidden = false;
  const askRecognizer = new AskSpeechRecognition();
  askRecognizer.lang = "en-US";
  askRecognizer.interimResults = false;
  askRecognizer.maxAlternatives = 1;
  let askListening = false;

  askRecognizer.addEventListener("result", (e) => {
    askInput.value = e.results[0][0].transcript;
    askInput.focus();
  });
  askRecognizer.addEventListener("end", () => {
    askListening = false;
    askMicBtn.classList.remove("listening");
  });
  askRecognizer.addEventListener("error", () => {
    askListening = false;
    askMicBtn.classList.remove("listening");
  });
  askMicBtn.addEventListener("click", () => {
    if (askListening) {
      askRecognizer.stop();
      return;
    }
    askListening = true;
    askMicBtn.classList.add("listening");
    try {
      askRecognizer.start();
    } catch (err) {
      askListening = false;
      askMicBtn.classList.remove("listening");
    }
  });
} else {
  askMicBtn.hidden = true;
}
