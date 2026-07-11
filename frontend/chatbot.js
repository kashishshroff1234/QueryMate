const API_BASE = "http://localhost:8000";
const chatScroll = document.getElementById("chat-scroll");
const emptyState = document.getElementById("empty-state");
const inputForm = document.getElementById("input-form");
const questionInput = document.getElementById("question-input");
const micBtn = document.getElementById("mic-btn");

const history = [];
let turnCounter = 0;

function uid() {
  turnCounter += 1;
  return `t${turnCounter}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function scrollToBottom() {
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function hideEmptyState() {
  if (emptyState) emptyState.style.display = "none";
}

function appendUserTurn(question) {
  hideEmptyState();
  const el = document.createElement("div");
  el.className = "turn-user";
  el.textContent = question;
  chatScroll.appendChild(el);
  scrollToBottom();
}

function appendLoadingTurn() {
  const el = document.createElement("div");
  el.className = "turn-assistant";
  el.id = "loading-turn";
  el.innerHTML = `
    <div class="loading-row">
      <span>writing query</span>
      <span class="loading-dots"><span></span><span></span><span></span></span>
    </div>`;
  chatScroll.appendChild(el);
  scrollToBottom();
  return el;
}

function removeLoadingTurn() {
  const el = document.getElementById("loading-turn");
  if (el) el.remove();
}

// ---------- API + mock fallback ----------

async function postQuery(question) {
  try {
    const resp = await fetch(`${API_BASE}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
    });
    if (!resp.ok) {
      const detail = await resp.json().catch(() => ({}));
      return { __error: true, ...(detail.detail || detail) };
    }
    return await resp.json();
  } catch (e) {
    return mockResponder(question);
  }
}

function mockResponder(question) {
  const q = question.toLowerCase();

  if (q.includes("low") && q.includes("stock")) {
    return {
      sql: "SELECT p.name, i.warehouse, i.stock_level FROM inventory i JOIN products p ON i.product_id = p.product_id WHERE i.stock_level < 50 ORDER BY i.stock_level ASC",
      columns: ["name", "warehouse", "stock_level"],
      rows: [
        ["Verve Blender", "WH-South", 12],
        ["Pulse Earbuds", "WH-East", 18],
        ["Atlas Hiking Boots", "WH-North", 24],
        ["Drift Yoga Mat", "WH-West", 31],
      ],
      row_count: 4,
      summary: "Four SKU/warehouse pairs are currently under the 50-unit threshold, with the Verve Blender at WH-South the most urgent at 12 units.",
      chart: { type: "bar", x: "name", y: "stock_level" },
      follow_up_questions: [
        "Which supplier provides the Verve Blender?",
        "How many units of Verve Blender were ordered last month?",
        "Are any low-stock products also top sellers?",
      ],
    };
  }

  if (q.includes("return")) {
    return {
      sql: "SELECT p.category, ROUND(100.0 * SUM(CASE WHEN o.status = 'returned' THEN 1 ELSE 0 END) / COUNT(*), 2) AS return_rate_pct FROM orders o JOIN products p ON o.product_id = p.product_id GROUP BY p.category ORDER BY return_rate_pct DESC",
      columns: ["category", "return_rate_pct"],
      rows: [
        ["Apparel", 15.2], ["Electronics", 13.8], ["Sports", 11.9],
        ["Beauty", 10.4], ["Toys", 9.7], ["Home & Kitchen", 8.3],
      ],
      row_count: 6,
      summary: "Apparel has the highest return rate at 15.2%, nearly double Home & Kitchen's 8.3%, which is the most return-resistant category.",
      chart: { type: "bar", x: "category", y: "return_rate_pct" },
      follow_up_questions: [
        "What's driving Apparel returns by specific product?",
        "Has Apparel's return rate changed month over month?",
        "What's the revenue impact of Apparel returns?",
      ],
    };
  }

  return {
    sql: "SELECT ROUND(SUM(o.quantity * p.unit_price), 2) AS total_revenue FROM orders o JOIN products p ON o.product_id = p.product_id WHERE o.status = 'completed'",
    columns: ["total_revenue"],
    rows: [[542318.67]],
    row_count: 1,
    summary: "Total revenue from completed orders over the dataset's full 18-month window is $542,318.67.",
    chart: { type: "none", x: null, y: null },
    follow_up_questions: [
      "How does this break down by month?",
      "Which category contributes the most revenue?",
      "What's the average order value?",
    ],
  };
}

// ---------- rendering ----------

function buildSqlBlock(sql) {
  const details = document.createElement("details");
  details.className = "collapsible sql-block";
  details.innerHTML = `
    <summary>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      <span class="label-icon">SQL</span><span>view generated query</span>
    </summary>
    <div class="collapsible-body"><pre class="sql-code"></pre></div>`;
  details.querySelector(".sql-code").textContent = sql;
  return details;
}

function buildResultTable(columns, rows, rowCount) {
  const details = document.createElement("details");
  details.className = "collapsible results-block";
  details.open = true;
  const shown = rows.slice(0, 20);

  const thead = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const tbody = shown
    .map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v === null ? "—" : String(v))}</td>`).join("")}</tr>`)
    .join("");

  details.innerHTML = `
    <summary>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      <span class="label-icon">Results</span><span>${rowCount} row${rowCount === 1 ? "" : "s"}</span>
    </summary>
    <div class="collapsible-body">
      <div class="result-table-wrap">
        <table class="result-table tabular">
          <thead>${thead}</thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
      <p class="result-footer">${shown.length} of ${rowCount} row${rowCount === 1 ? "" : "s"} shown</p>
    </div>`;
  return details;
}

function buildChartBlock(chartMeta, columns, rows) {
  if (!chartMeta || chartMeta.type === "none") return null;

  const details = document.createElement("details");
  details.className = "collapsible chart-block";
  details.open = true;
  details.innerHTML = `
    <summary>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      <span class="label-icon">Chart</span><span>${chartMeta.type} chart</span>
    </summary>
    <div class="collapsible-body"><div class="chart-block-wrap"><canvas></canvas></div></div>`;

  const xIdx = columns.indexOf(chartMeta.x);
  const yIdx = columns.indexOf(chartMeta.y);
  if (xIdx === -1 || yIdx === -1) return null;

  const labels = rows.map((r) => String(r[xIdx]));
  const values = rows.map((r) => Number(r[yIdx]));
  const seriesColors = ["#e08a2c", "#4fd1a5", "#5b9dff", "#c98bf0", "#f0c75e", "#f0556a"];

  requestAnimationFrame(() => {
    const canvas = details.querySelector("canvas");
    new Chart(canvas, {
      type: chartMeta.type === "line" ? "line" : "bar",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: chartMeta.type === "line"
            ? "rgba(79, 209, 165, 0.14)"
            : labels.map((_, i) => seriesColors[i % seriesColors.length]),
          borderColor: chartMeta.type === "line" ? "#6ee6bd" : undefined,
          fill: chartMeta.type === "line",
          tension: 0.35,
          borderRadius: chartMeta.type === "bar" ? 4 : 0,
          pointRadius: chartMeta.type === "line" ? 0 : undefined,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 420 },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#2e3340" }, ticks: { color: "#a3a7b5", font: { size: 11 } } },
          y: { grid: { color: "#2e3340" }, ticks: { color: "#a3a7b5", font: { size: 11 } } },
        },
      },
    });
  });

  return details;
}

function buildExportButton(columns, rows, filenameHint) {
  const btn = document.createElement("button");
  btn.className = "export-btn";
  btn.type = "button";
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
    Export CSV`;
  btn.addEventListener("click", () => {
    const csv = [columns.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
    downloadBlob(csv, `querymate_${filenameHint}.csv`, "text/csv");
  });
  return btn;
}

function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildFollowupRow(questions) {
  if (!questions || !questions.length) return null;
  const row = document.createElement("div");
  row.className = "followup-row";
  questions.forEach((q) => {
    const chip = document.createElement("button");
    chip.className = "followup-chip";
    chip.type = "button";
    chip.textContent = q;
    chip.addEventListener("click", () => submitQuestion(q));
    row.appendChild(chip);
  });
  return row;
}

function buildErrorBlock(detail) {
  const el = document.createElement("div");
  el.className = "error-block";
  const message = detail.error || "That question couldn't be turned into a safe query.";
  const reason = detail.reason ? `reason: ${detail.reason}` : "";
  el.innerHTML = `
    <p class="error-message"></p>
    ${reason ? '<p class="error-reason"></p>' : ""}`;
  el.querySelector(".error-message").textContent = message;
  if (reason) el.querySelector(".error-reason").textContent = reason;
  return el;
}

function buildLargeResultBanner(data) {
  const wrap = document.createElement("div");
  wrap.className = "large-result-banner";
  wrap.innerHTML = `
    <p>This result has ${data.row_count.toLocaleString()} rows. Showing a preview of ${data.preview_rows.length}.</p>
    <div class="large-result-actions">
      <button class="btn-secondary" type="button" data-action="preview">Show preview</button>
      <button class="btn-primary" type="button" data-action="download">Download full results (CSV)</button>
    </div>`;

  const body = document.createElement("div");
  body.style.display = "none";
  body.style.marginTop = "var(--space-3)";

  wrap.querySelector('[data-action="preview"]').addEventListener("click", (e) => {
    if (body.childElementCount === 0) {
      body.appendChild(buildResultTable(data.preview_columns, data.preview_rows, data.row_count));
      const chart = buildChartBlock(data.chart, data.preview_columns, data.preview_rows);
      if (chart) body.appendChild(chart);
    }
    body.style.display = body.style.display === "none" ? "block" : "none";
    e.target.textContent = body.style.display === "none" ? "Show preview" : "Hide preview";
  });

  wrap.querySelector('[data-action="download"]').addEventListener("click", async (e) => {
    const btn = e.target;
    const original = btn.textContent;
    btn.textContent = "Preparing download...";
    btn.disabled = true;
    try {
      const resp = await fetch(`${API_BASE}/api/download/${data.download_token}`);
      if (!resp.ok) throw new Error("download failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "querymate_export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      btn.textContent = "Download failed, try again";
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
      return;
    }
    btn.textContent = original;
    btn.disabled = false;
  });

  wrap.appendChild(body);
  return wrap;
}

function appendAssistantTurn(data) {
  const turn = document.createElement("div");
  turn.className = "turn-assistant";

  if (data.__error) {
    turn.appendChild(buildErrorBlock(data));
    chatScroll.appendChild(turn);
    scrollToBottom();
    return;
  }

  const summaryEl = document.createElement("div");
  summaryEl.className = "summary-block";
  summaryEl.textContent = data.summary || "";
  turn.appendChild(summaryEl);

  turn.appendChild(buildSqlBlock(data.sql));

  if (data.large_result) {
    turn.appendChild(buildLargeResultBanner(data));
  } else {
    turn.appendChild(buildResultTable(data.columns, data.rows, data.row_count));
    const chart = buildChartBlock(data.chart, data.columns, data.rows);
    if (chart) turn.appendChild(chart);
    turn.appendChild(buildExportButton(data.columns, data.rows, "export"));
  }

  const followups = buildFollowupRow(data.follow_up_questions);
  if (followups) turn.appendChild(followups);

  chatScroll.appendChild(turn);
  scrollToBottom();
}

// ---------- submission flow ----------

async function submitQuestion(question) {
  question = question.trim();
  if (!question) return;

  appendUserTurn(question);
  questionInput.value = "";
  appendLoadingTurn();

  const data = await postQuery(question);
  removeLoadingTurn();
  appendAssistantTurn(data);

  if (!data.__error) {
    history.push({ question, sql: data.sql || (data.large_result ? "" : ""), summary: data.summary || "" });
  }
}

inputForm.addEventListener("submit", (e) => {
  e.preventDefault();
  submitQuestion(questionInput.value);
});

document.querySelectorAll(".chip[data-question]").forEach((chip) => {
  chip.addEventListener("click", () => submitQuestion(chip.dataset.question));
});

// ---------- speech input ----------

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognitionImpl) {
  micBtn.hidden = false;
  const recognizer = new SpeechRecognitionImpl();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  let listening = false;

  recognizer.addEventListener("result", (e) => {
    const transcript = e.results[0][0].transcript;
    questionInput.value = transcript;
    questionInput.focus();
  });

  recognizer.addEventListener("end", () => {
    listening = false;
    micBtn.classList.remove("listening");
  });

  recognizer.addEventListener("error", () => {
    listening = false;
    micBtn.classList.remove("listening");
  });

  micBtn.addEventListener("click", () => {
    if (listening) {
      recognizer.stop();
      return;
    }
    listening = true;
    micBtn.classList.add("listening");
    try {
      recognizer.start();
    } catch (err) {
      listening = false;
      micBtn.classList.remove("listening");
    }
  });
} else {
  micBtn.hidden = true;
}
