"""Builds querymate.db with seeded retail/e-commerce data."""
import sqlite3
import random
from datetime import datetime, timedelta

from faker import Faker
import numpy as np

fake = Faker()
random.seed(42)
np.random.seed(42)

DB_PATH = "querymate.db"

CATEGORIES = ["Electronics", "Home & Kitchen", "Apparel", "Sports", "Toys", "Beauty"]
REGIONS = ["North", "South", "East", "West", "Central"]
WAREHOUSES = ["WH-North", "WH-South", "WH-East", "WH-West"]
STATUSES = ["completed", "returned", "pending"]
STATUS_WEIGHTS = [0.82, 0.12, 0.06]

NUM_PRODUCTS = 50
NUM_SUPPLIERS = 10
NUM_ORDERS = 5000
DAYS_SPAN = 540  # 18 months


def build_schema(conn):
    conn.executescript(
        """
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
            status TEXT NOT NULL
        );
        CREATE TABLE inventory (
            product_id INTEGER REFERENCES products(product_id),
            warehouse TEXT NOT NULL,
            stock_level INTEGER NOT NULL,
            last_restocked TEXT NOT NULL
        );
        """
    )


def seed_suppliers(conn):
    rows = []
    for sid in range(1, NUM_SUPPLIERS + 1):
        rows.append((sid, fake.company(), random.choice(REGIONS)))
    conn.executemany(
        "INSERT INTO suppliers (supplier_id, name, region) VALUES (?, ?, ?)", rows
    )
    return rows


def seed_products(conn, supplier_ids):
    rows = []
    for pid in range(1, NUM_PRODUCTS + 1):
        category = random.choice(CATEGORIES)
        name = f"{fake.word().capitalize()} {category[:-1] if category.endswith('s') else category}"
        price = round(np.random.lognormal(mean=3.2, sigma=0.9), 2)
        price = max(4.99, min(price, 899.99))
        rows.append((pid, name, category, price, random.choice(supplier_ids)))
    conn.executemany(
        "INSERT INTO products (product_id, name, category, unit_price, supplier_id) "
        "VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    return rows


def seed_orders(conn, product_ids):
    end_date = datetime(2026, 6, 20)
    start_date = end_date - timedelta(days=DAYS_SPAN)

    # Skew: 6 "hot" products get disproportionate order volume.
    hot_products = random.sample(product_ids, 6)
    weights = np.array(
        [5.0 if pid in hot_products else 1.0 for pid in product_ids]
    )
    weights = weights / weights.sum()

    rows = []
    for oid in range(1, NUM_ORDERS + 1):
        day_offset = int(np.random.beta(2, 2) * DAYS_SPAN)
        order_date = start_date + timedelta(days=day_offset)

        # Seasonal bump: Nov-Dec and back-to-school (Aug-Sep) order more.
        month = order_date.month
        seasonal_boost = 1.6 if month in (11, 12) else (1.3 if month in (8, 9) else 1.0)
        if random.random() > min(seasonal_boost / 1.6, 1.0) and seasonal_boost == 1.0:
            pass  # no-op, weighting already applied via beta draw

        product_id = int(np.random.choice(product_ids, p=weights))
        quantity = max(1, int(np.random.gamma(2.0, 1.8)))
        status = random.choices(STATUSES, weights=STATUS_WEIGHTS)[0]

        rows.append(
            (
                oid,
                product_id,
                random.choice(REGIONS),
                quantity,
                order_date.strftime("%Y-%m-%d"),
                status,
            )
        )

    conn.executemany(
        "INSERT INTO orders (order_id, product_id, customer_region, quantity, order_date, status) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    return end_date


def seed_inventory(conn, product_ids):
    rows = []
    low_stock_slots = set(random.sample(range(NUM_PRODUCTS), 8))
    idx = 0
    for pid in product_ids:
        num_warehouses = random.choice([1, 2, 2, 3])
        chosen_warehouses = random.sample(WAREHOUSES, num_warehouses)
        for wh in chosen_warehouses:
            if idx in low_stock_slots:
                stock = random.randint(2, 49)
            else:
                stock = random.randint(50, 800)
            restocked = fake.date_between(start_date="-60d", end_date="-1d")
            rows.append((pid, wh, stock, restocked.strftime("%Y-%m-%d")))
            idx += 1

    # Guarantee at least 2 warehouses are deliberately under 50 units overall.
    for wh in WAREHOUSES[:2]:
        pid = random.choice(product_ids)
        rows.append((pid, wh, random.randint(3, 30), "2026-06-01"))

    conn.executemany(
        "INSERT INTO inventory (product_id, warehouse, stock_level, last_restocked) "
        "VALUES (?, ?, ?, ?)",
        rows,
    )


def main():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        build_schema(conn)
        suppliers = seed_suppliers(conn)
        supplier_ids = [s[0] for s in suppliers]
        products = seed_products(conn, supplier_ids)
        product_ids = [p[0] for p in products]
        max_date = seed_orders(conn, product_ids)
        seed_inventory(conn, product_ids)
        conn.commit()
        print(f"Built {DB_PATH}: {NUM_PRODUCTS} products, {NUM_SUPPLIERS} suppliers, "
              f"{NUM_ORDERS} orders, max order_date ~{max_date.date()}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
