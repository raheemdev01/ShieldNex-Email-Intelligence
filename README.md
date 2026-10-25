# ShieldNex Email Checker

A small Flask web app for the ShieldNex Aerospace Software Development selection task. Paste or import a list of email addresses and receive one of the three requested categories: **Delivered**, **Likely to Bounce**, or **Unknown**.

## What it checks

- Email syntax using `email-validator` without probing an individual mailbox.
- Domain-level DNS mail-routing signals using MX records. If no MX record exists, it checks address records as a conservative implicit-MX fallback.
- DNS timeouts, unavailable nameservers, and ambiguous results are reported as **Unknown** rather than automatically treated as invalid.
- Unique domains are looked up once per API batch, with up to 20 concurrent DNS lookups to reduce serial waiting on large lists. Duplicate input addresses remain in the output.
- Supports newline-, comma-, and semicolon-separated input, plus `.txt` and `.csv` import up to 5 MB. The UI accepts up to 5,000 addresses per run and automatically sends them to the API in batches of 100. The API itself intentionally caps each request at 100 addresses; this is a per-request batch size, not the total run limit.
- Filter and search results, browse results in 100-row pages (to keep the interface responsive for 5,000 results), export CSV, copy a summary, and copy Unknown addresses.
- CSV export quotes fields and guards against spreadsheet formula injection.
- `/health` provides a simple deployment health check.

## Important limitation

This app does **not** send email, attempt SMTP mailbox probing, or confirm that a specific mailbox exists. In the task's three-category format, **Delivered** means a positive domain-level mail-routing signal was found; it is not proof that the mailbox exists or that a message will arrive. **Likely to Bounce** is used for invalid syntax or strong domain-failure evidence. **Unknown** is used when DNS evidence is inconclusive or unavailable. Some hosting providers block DNS requests; in that case the deployed app may return more Unknown results.

## Run locally

Requires Python 3.10 or newer.

```bash
python -m venv .venv
```

Activate the environment:

- Windows PowerShell: `\.venv\Scripts\Activate.ps1`
- macOS/Linux: `source .venv/bin/activate`

Install dependencies and start the app:

```bash
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000` in your browser. The local server runs with debug mode disabled by default.

## Run tests

Install the runtime requirements, then run:

```bash
python -m unittest discover -s tests -v
```

The tests mock DNS/domain checks where appropriate so automated tests do not generate large numbers of live DNS requests.

## Deploy

1. Push this repository to GitHub.
2. Create a Python Web Service on a host such as Render and connect the repository.
3. Use `pip install -r requirements.txt` as the build command if required.
4. Use `gunicorn app:app` as the start command.
5. Deploy, open the public URL, and test both the home page and `/health`.

DNS access may be restricted by the hosting network. Check the deployed app's actual behavior and describe any DNS limitation in your submission.

## API

`POST /api/check` with JSON:

```json
{"emails":"person@example.com\ninvalid-address"}
```

The response includes itemized results, counts, elapsed time, number of unique domains checked, and duplicate-address count. Each API request with more than 100 addresses receives HTTP 400. The browser coordinates multiple 100-address requests for larger runs, up to 5,000 addresses.

## Privacy and safety

- No messages are sent to the submitted addresses.
- Submitted lists are processed in memory and are not intentionally persisted by this app.
- Avoid entering sensitive personal or confidential address lists into public tools.

## Project structure

```text
shieldnex-email-checker/
├── app.py
├── requirements.txt
├── Procfile
├── README.md
├── templates/index.html
├── static/app.js
├── static/style.css
└── tests/test_app.py
```
