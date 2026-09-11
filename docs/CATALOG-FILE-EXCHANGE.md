# Catalog file exchange

Import / Export now supports catalog and stock CSV downloads plus reviewed new-product imports. Staff with catalog management access can preview up to 100 rows/12 KB, then explicitly create inactive unpublished drafts. CPA access is export-only. Accounting links use existing date-filtered expense/mileage/CPA exports; QuickBooks posting is separate and remains unfinished.

The template uses product_key, product_name, brand, sku, variant_name, retail_price_usd, tax_code and capacity_units. Product keys group variants under one parent. Rows in a group must agree on parent fields. Prices use positive integer cents; tax code and capacity are explicit. Existing product keys/SKUs, duplicate input SKUs, inconsistent groups and malformed data are rejected. This is a create-only importer, not a tool for overwriting current catalog, stock, historical prices or accounting.

The reviewed payload hash is rechecked at apply. All new products, variants, one retail price each, zero inventory balances and audit receipts commit in one transaction. Request-key receipts recover a lost response exactly once. Concurrent competing imports and unique conflicts cannot partially create a batch. Receiving and publication remain separate existing workflows.

Exports use a consistent database snapshot, include inactive variants, and support a SKU-prefix filter with a 5,000-variant bound. Stock export uses existing availability rules. A missing or overlapping current retail price is exported blank. Formula prefixes are neutralized and cells are quoted. Exports contain catalog/stock data, no customer records.

No migration or external provider is required. Imported draft data must be reviewed for classification, photos, pricing, tax and delivery attributes and supplied through normal receiving before activation/publication.
