# QueryMate

Conversational NL2SQL analytics assistant for retail/e-commerce data.
Hackathon-scale prototype: ask a question in plain English, Claude writes
SQL, sqlglot validates it, it runs read-only against SQLite, a second
Claude call summarizes the result and suggests follow-ups.

## Structure

```
backend/
  generate_data.py   # builds querymate.db (50 products, 10 suppliers, 5000 orders, 4 warehouses)
  validator.py       # sqlglot-based SQL safety gate
  prompts.py         # prompt templates for generation + summarization
  main.py            # FastAPI app
  requirements.txt
  .env.example
frontend/
  tokens.css         # shared design tokens
  dashboard.html/js/css
  chatbot.html/js/css
  mock-data.js       # dashboard mock data, swappable for /api/dashboard later
```

## Run the backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in ANTHROPIC_API_KEY
python generate_data.py
uvicorn main:app --reload --port 8000
```

## Run the frontend

Plain static files, no build step. From `frontend/`:

```bash
python -m http.server 8080
```

Open `http://localhost:8080/dashboard.html`. The chatbot tries
`POST /api/query` against the same origin first; if the backend isn't
reachable (e.g. you're serving frontend and backend on different ports),
it falls back to a built-in mock responder so the page still demos.

If you serve frontend and backend separately, either:
- proxy `/api/*` from your static server to `http://localhost:8000`, or
- set `FRONTEND_ORIGIN` in `.env` to your static server's origin and
  change `API_BASE` in `chatbot.js` to `http://localhost:8000`.

## Notes

- Row-count branching: queries returning ≤500 rows execute and return
  fully; queries over 500 rows execute a 50-row `LIMIT` preview and cache
  the full validated SQL behind a UUID download token (in-memory, 1hr
  TTL). `GET /api/download/{token}` re-runs the full query and streams
  CSV.
- The validator rejects non-SELECT statements, multi-statement strings,
  unknown tables/columns, and ungrouped aggregates. One retry round-trip
  to Claude on validation failure, then a clean 422 with the rejected SQL
  and reason.
- SQLite is opened `mode=ro` as a second independent safety layer.
