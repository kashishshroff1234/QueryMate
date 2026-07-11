"""Prompt construction for SQL generation and result summarization."""

SCHEMA_DDL = """
CREATE TABLE products (
    product_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit_price REAL NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(supplier_id)
);
CREATE TABLE suppliers (
    supplier_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL
);
CREATE TABLE orders (
    order_id INTEGER PRIMARY KEY,
    product_id INTEGER REFERENCES products(product_id),
    customer_region TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    order_date TEXT NOT NULL,
    status TEXT NOT NULL  -- 'completed', 'returned', 'pending'
);
CREATE TABLE inventory (
    product_id INTEGER REFERENCES products(product_id),
    warehouse TEXT NOT NULL,
    stock_level INTEGER NOT NULL,
    last_restocked TEXT NOT NULL
);
""".strip()

COLUMN_GLOSSARY = """
- "revenue" means quantity * unit_price, computed by joining orders to products on product_id.
  Unless the question says otherwise, compute revenue only over orders.status = 'completed'.
- "returns" or "return rate" refers to orders.status = 'returned'. Return rate = returned / total orders.
- "low stock" means inventory.stock_level < 50.
- "region" without qualification in a question about sales/orders means orders.customer_region.
  "region" in a question about suppliers means suppliers.region. Do not conflate the two.
- order_date is stored as TEXT in 'YYYY-MM-DD' format. Use SQLite date functions
  (date(), strftime()) for date arithmetic, not Python-style parsing.
""".strip()

FEW_SHOTS = [
    {
        "q": "What's our total revenue from completed orders?",
        "sql": (
            "SELECT ROUND(SUM(o.quantity * p.unit_price), 2) AS total_revenue "
            "FROM orders o JOIN products p ON o.product_id = p.product_id "
            "WHERE o.status = 'completed'"
        ),
    },
    {
        "q": "Which supplier region has the highest average product price?",
        "sql": (
            "SELECT s.region, ROUND(AVG(p.unit_price), 2) AS avg_price "
            "FROM products p JOIN suppliers s ON p.supplier_id = s.supplier_id "
            "GROUP BY s.region ORDER BY avg_price DESC"
        ),
    },
    {
        "q": "Show me orders from the last 30 days relative to today.",
        "sql": (
            "SELECT * FROM orders "
            "WHERE order_date >= date('{today}', '-30 days')"
        ),
    },
    {
        "q": "Which categories have more than 100 completed orders?",
        "sql": (
            "SELECT p.category, COUNT(*) AS order_count "
            "FROM orders o JOIN products p ON o.product_id = p.product_id "
            "WHERE o.status = 'completed' "
            "GROUP BY p.category HAVING COUNT(*) > 100 ORDER BY order_count DESC"
        ),
    },
    {
        "q": "What's the return rate by product category?",
        "sql": (
            "SELECT p.category, "
            "ROUND(100.0 * SUM(CASE WHEN o.status = 'returned' THEN 1 ELSE 0 END) / COUNT(*), 2) AS return_rate_pct "
            "FROM orders o JOIN products p ON o.product_id = p.product_id "
            "GROUP BY p.category ORDER BY return_rate_pct DESC"
        ),
    },
]


def build_generation_prompt(question: str, history: list[dict], today: str) -> str:
    shots = "\n\n".join(
        f"Q: {s['q']}\nSQL: {s['sql'].format(today=today)}" for s in FEW_SHOTS
    )

    history_block = ""
    if history:
        turns = "\n".join(
            f"Q: {h['question']}\nSQL: {h['sql']}\nA: {h.get('summary', '')}"
            for h in history[-5:]
        )
        history_block = f"\nConversation so far:\n{turns}\n"

    return f"""You are a SQL generator for a retail analytics SQLite database.

Schema:
{SCHEMA_DDL}

Business term glossary:
{COLUMN_GLOSSARY}

Today's date (use this for any relative date question like "last 30 days" or "this month"): {today}

Examples:
{shots}
{history_block}
New question: {question}

Output ONLY the raw SQL query. No markdown fences, no prose, no explanation. \
SQLite dialect. SELECT statements only."""


def build_retry_prompt(question: str, rejected_sql: str, error: str, today: str) -> str:
    return f"""Your previous SQL was rejected by the validator.

Question: {question}
Rejected SQL: {rejected_sql}
Validator error: {error}

Schema:
{SCHEMA_DDL}

Business term glossary:
{COLUMN_GLOSSARY}

Today's date: {today}

Output ONLY the corrected raw SQL query. No markdown fences, no prose. \
SQLite dialect. SELECT statements only."""


def build_summary_prompt(question: str, sql: str, columns: list[str], sample_rows: list[list], row_count: int) -> str:
    sample = sample_rows[:10]
    return f"""A user asked a retail analytics question. Here is the question, the SQL \
that answered it, and a sample of the results.

Question: {question}
SQL: {sql}
Result columns: {columns}
Result row count: {row_count}
Sample rows (up to 10): {sample}

Respond with ONLY a JSON object, no markdown fences, no prose outside the JSON, with exactly these fields:
{{
  "summary": "2-3 sentence plain-English answer to the question, grounded in the actual numbers shown",
  "chart": {{"type": "bar" | "line" | "none", "x": "<column name or null>", "y": "<column name or null>"}},
  "follow_up_questions": ["<question 1>", "<question 2>", "<question 3>"]
}}

Rules:
- chart.type is "line" only for time-series data (a date/month column on x). "bar" for categorical \
comparisons. "none" if the result is a single scalar value or doesn't chart meaningfully.
- chart.x and chart.y must be exact column names from result columns, or null if chart.type is "none".
- follow_up_questions must be 3 short, specific natural-language questions a business analyst would \
plausibly ask next, grounded in the actual columns and values in this result. Not generic questions."""
