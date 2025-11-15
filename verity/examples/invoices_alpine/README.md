# Invoices (Alpine) Examples

Two Alpine-powered invoice dashboards live side-by-side for benchmarking:

* **`invoices_alpine/`** – the library-driven data layer that leans on the VerityDL helpers.
* **`invoices_alpine_baseline/`** – a manual baseline that manages fetches, caching, and SSE with vanilla Alpine stores.

Both projects share the same Flask backend shape, seeded SQLite database, and REST/SSE endpoints so you can compare UX and performance characteristics directly.

## Prerequisites

From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run the library-driven build

```bash
    cd verity/examples/invoices_alpine
python app.py
```

This starts the app on <http://localhost:5000>. Use a different port by running `flask --app app run --port 5000` or any port you prefer.

## Run the manual baseline

```bash
    cd verity/examples/invoices_alpine_baseline
FLASK_APP=app flask run --port 5001
```

The baseline defaults to the same port in its `app.run` block, so using `flask run` with an explicit port (for example `5001`) lets you keep both servers running for head-to-head testing.

## Resetting the demo database

Each app stores its SQLite file (`app2.db`) inside its own directory. Delete the file before starting the server to repopulate the seeded invoices.
