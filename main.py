"""QueryMate backend: NL question -> validated SQL -> result + summary."""
import csv
import io
import json
import os
import sqlite3
import time
import uuid
import httpx
from contextlib import contextmanager
from typing import Optional
from openai import OpenAI
# from anthropic import Anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from prompts import build_generation_prompt, build_retry_prompt, build_summary_prompt
from validator import validate_sql

load_dotenv()

print("Loaded API key ends with:", os.environ.get("OPENAI_API_KEY", "")[-8:])

DB_PATH = os.environ.get("QUERYMATE_DB_PATH", "querymate.db")
MODEL = os.environ.get("OPENAI_MODEL", "azure_ai/genailab-maas-DeepSeek-V3-0324")
ROW_LIMIT_THRESHOLD = 500
PREVIEW_LIMIT = 50
DOWNLOAD_TOKEN_TTL_SECONDS = 3600

app = FastAPI(title="QueryMate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "*")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_http_client = httpx.Client(verify=False)
client = OpenAI(
    base_url=os.environ.get("OPENAI_BASE_URL", "https://genailab.tcs.in"),
    api_key=os.environ.get("OPENAI_API_KEY"),
    http_client=_http_client,
)

# token -> {"sql": str, "created_at": float}
_download_cache: dict[str, dict] = {}


class QueryRequest(BaseModel):
    question: str
    history: list[dict] = []


@contextmanager
def get_ro_connection():
    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    try:
        yield conn
    finally:
        conn.close()


def _get_max_order_date() -> str:
    with get_ro_connection() as conn:
        row = conn.execute("SELECT MAX(order_date) FROM orders").fetchone()
        return row[0] if row and row[0] else "2026-06-20"


def _call_claude_for_sql(prompt: str) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content.strip()

def _call_claude_for_summary(prompt: str) -> dict:
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.choices[0].message.content.strip()
    print("=== RAW SUMMARY RESPONSE START ===")
    print(text)
    print("=== RAW SUMMARY RESPONSE END ===")
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print("JSON PARSE FAILED:", e)
        return {
            "summary": "I ran the query but couldn't generate a clean summary for it.",
            "chart": {"type": "none", "x": None, "y": None},
            "follow_up_questions": [],
        }

# def _call_claude_for_summary(prompt: str) -> dict:
#     resp = client.chat.completions.create(
#         model=MODEL,
#         max_tokens=600,
#         messages=[{"role": "user", "content": prompt}],
#         response_format={"type": "json_object"},
#     )
#     text = resp.choices[0].message.content.strip()
#     try:
#         return json.loads(text)
#     except json.JSONDecodeError:
#         return {
#             "summary": "I ran the query but couldn't generate a clean summary for it.",
#             "chart": {"type": "none", "x": None, "y": None},
#             "follow_up_questions": [],
#         }


def _execute(sql: str, params: tuple = ()) -> tuple[list[str], list[list]]:
    with get_ro_connection() as conn:
        cursor = conn.execute(sql, params)
        columns = [d[0] for d in cursor.description]
        rows = [list(r) for r in cursor.fetchall()]
        return columns, rows


def _row_count(sql: str) -> int:
    with get_ro_connection() as conn:
        cursor = conn.execute(f"SELECT COUNT(*) FROM ({sql})")
        return cursor.fetchone()[0]


def _prune_expired_tokens():
    now = time.time()
    expired = [t for t, v in _download_cache.items() if now - v["created_at"] > DOWNLOAD_TOKEN_TTL_SECONDS]
    for t in expired:
        del _download_cache[t]


@app.post("/api/query")
def run_query(req: QueryRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail={"error": "Question cannot be empty."})

    today = _get_max_order_date()

    gen_prompt = build_generation_prompt(question, req.history, today)
    raw_sql = _call_claude_for_sql(gen_prompt)
    is_valid, result = validate_sql(raw_sql)

    llm_calls = 1

    if not is_valid:
        retry_prompt = build_retry_prompt(question, raw_sql, result, today)
        raw_sql_retry = _call_claude_for_sql(retry_prompt)
        llm_calls += 1
        is_valid, result = validate_sql(raw_sql_retry)
        raw_sql = raw_sql_retry

        if not is_valid:
            return _error_response(
                "I can only run read queries against this dataset, and couldn't "
                "form a valid one for that question.",
                raw_sql,
                result,
            )

    sql = result

    try:
        true_count = _row_count(sql)
    except sqlite3.Error as e:
        return _error_response(
            "That query didn't run cleanly against the dataset.", sql, str(e)
        )

    if true_count <= ROW_LIMIT_THRESHOLD:
        try:
            columns, rows = _execute(sql)
        except sqlite3.Error as e:
            return _error_response(
                "That query didn't run cleanly against the dataset.", sql, str(e)
            )

        summary_prompt = build_summary_prompt(question, sql, columns, rows, true_count)
        meta = _call_claude_for_summary(summary_prompt)

        return {
            "sql": sql,
            "columns": columns,
            "rows": rows,
            "row_count": true_count,
            "summary": meta.get("summary", ""),
            "chart": meta.get("chart", {"type": "none", "x": None, "y": None}),
            "follow_up_questions": meta.get("follow_up_questions", []),
        }

    preview_sql = f"{sql} LIMIT {PREVIEW_LIMIT}"
    try:
        preview_columns, preview_rows = _execute(preview_sql)
    except sqlite3.Error as e:
        return _error_response(
            "That query didn't run cleanly against the dataset.", sql, str(e)
        )

    _prune_expired_tokens()
    token = str(uuid.uuid4())
    _download_cache[token] = {"sql": sql, "created_at": time.time()}

    summary_prompt = build_summary_prompt(question, sql, preview_columns, preview_rows, true_count)
    meta = _call_claude_for_summary(summary_prompt)

    return {
        "large_result": True,
        "row_count": true_count,
        "preview_columns": preview_columns,
        "preview_rows": preview_rows,
        "download_token": token,
        "summary": meta.get("summary", ""),
        "chart": meta.get("chart", {"type": "none", "x": None, "y": None}),
        "follow_up_questions": meta.get("follow_up_questions", []),
    }


@app.get("/api/download/{token}")
def download(token: str):
    _prune_expired_tokens()
    entry = _download_cache.get(token)
    if not entry:
        raise HTTPException(status_code=404, detail={"error": "This download link has expired."})

    try:
        columns, rows = _execute(entry["sql"])
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail={"error": "Could not regenerate the export.", "reason": str(e)})

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    writer.writerows(rows)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=querymate_export.csv"},
    )


def _error_response(message: str, attempted_sql: str, reason: str):
    raise HTTPException(
        status_code=422,
        detail={"error": message, "attempted_sql": attempted_sql, "reason": reason},
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}
