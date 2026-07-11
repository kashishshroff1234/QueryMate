"""Validates generated SQL before it touches the database.

Defense in depth: this is the layer that decides whether SQL runs at all.
sqlite3's read-only connection mode is the second layer (see main.py).
"""
import sqlglot
from sqlglot import exp

ALLOWED_TABLES = {"products", "suppliers", "orders", "inventory"}

ALLOWED_COLUMNS = {
    "products": {"product_id", "name", "category", "unit_price", "supplier_id"},
    "suppliers": {"supplier_id", "name", "region"},
    "orders": {
        "order_id", "product_id", "customer_region", "quantity",
        "order_date", "status",
    },
    "inventory": {"product_id", "warehouse", "stock_level", "last_restocked"},
}

FORBIDDEN_EXPR_TYPES = (
    exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create,
    exp.Alter, exp.Command, exp.Pragma,
)


class ValidationError(Exception):
    pass


def _strip_fences(sql: str) -> str:
    sql = sql.strip()
    if sql.startswith("```"):
        lines = sql.split("\n")
        lines = lines[1:] if lines[0].startswith("```") else lines
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        sql = "\n".join(lines)
    return sql.strip().rstrip(";").strip()


def _parsed_tables(parsed: exp.Expression) -> set[str]:
    return {t.name.lower() for t in parsed.find_all(exp.Table)}


def _parsed_columns_by_table(parsed: exp.Expression) -> dict[str, set[str]]:
    """Best-effort column -> declaring-table map for aliased single-table refs.

    For multi-table joins without explicit qualification this degrades to a
    union check against all referenced tables' allowed columns, which is
    intentionally permissive (column-name collisions across our 4 tables are
    rare) rather than rejecting legitimate joins.
    """
    tables = _parsed_tables(parsed)
    allowed_union: set[str] = set()
    for t in tables:
        allowed_union |= ALLOWED_COLUMNS.get(t, set())
    return {"*": allowed_union}


def _check_aggregate_without_group_by(select: exp.Select) -> bool:
    """Returns True if invalid: aggregate + bare column with no GROUP BY."""
    has_aggregate = any(
        isinstance(e, exp.AggFunc) or
        (isinstance(e, exp.Anonymous) and e.name.upper() in {"COUNT", "SUM", "AVG", "MIN", "MAX"})
        for e in select.expressions
    ) or any(select.find_all(exp.AggFunc))

    if not has_aggregate:
        return False

    has_group_by = select.args.get("group") is not None

    if has_group_by:
        return False

    # Aggregate present, no GROUP BY: every select expression must itself be
    # an aggregate (or wrap one), otherwise it's an ungrouped bare column.
    for projection in select.expressions:
        target = projection.this if isinstance(projection, exp.Alias) else projection
        if isinstance(target, exp.Column):
            return True
        if isinstance(target, exp.Star):
            return True
    return False


def validate_sql(raw_sql: str) -> tuple[bool, str]:
    """Returns (is_valid, sql_or_error_message)."""
    sql = _strip_fences(raw_sql)

    if not sql:
        return False, "empty query"

    if ";" in sql:
        return False, "multi-statement queries are not allowed"

    try:
        statements = sqlglot.parse(sql, dialect="sqlite")
    except Exception as e:
        return False, f"parse error: {e}"

    if len(statements) != 1 or statements[0] is None:
        return False, "expected exactly one statement"

    parsed = statements[0]

    if not isinstance(parsed, exp.Select):
        return False, "only SELECT statements are allowed"

    for forbidden in FORBIDDEN_EXPR_TYPES:
        if parsed.find(forbidden):
            return False, f"forbidden statement type: {forbidden.__name__}"

    if "attach" in sql.lower().split():
        return False, "ATTACH DATABASE is not allowed"

    tables = _parsed_tables(parsed)
    unknown_tables = tables - ALLOWED_TABLES
    if unknown_tables:
        return False, f"unknown table(s): {unknown_tables}"

    if not tables:
        return False, "no tables referenced"

    col_map = _parsed_columns_by_table(parsed)
    allowed_cols = col_map["*"]
    referenced_cols = {
        c.name.lower() for c in parsed.find_all(exp.Column) if c.name != "*"
    }
    unknown_cols = referenced_cols - allowed_cols
    if unknown_cols:
        return False, f"unknown column(s): {unknown_cols}"

    selects = list(parsed.find_all(exp.Select))
    for select in selects:
        if _check_aggregate_without_group_by(select):
            return False, "aggregate function mixed with non-aggregated column, missing GROUP BY"

    return True, sql
