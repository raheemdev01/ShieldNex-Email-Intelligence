from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from time import perf_counter

import dns.exception
import dns.resolver
from email_validator import EmailNotValidError, validate_email
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024
MAX_BATCH_SIZE = 100
DNS_TIMEOUT_SECONDS = 2.0


def check_domain(domain: str, cache: dict[str, dict]) -> dict:
    """Return a cached domain-level mail-routing signal, never mailbox proof."""
    domain = domain.rstrip(".").lower()
    if domain in cache:
        return cache[domain]

    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=DNS_TIMEOUT_SECONDS)
        hosts = sorted({str(answer.exchange).rstrip(".") for answer in answers})
        if hosts:
            signal = {
                "kind": "delivered",
                "detail": f"Domain mail-routing signal found (MX records: {', '.join(hosts[:2])}). This does not confirm that this mailbox exists or that a message will arrive.",
            }
        else:
            signal = {
                "kind": "unknown",
                "detail": "The DNS lookup returned no usable MX records. The address's delivery status cannot be confirmed.",
            }
    except dns.resolver.NXDOMAIN:
        signal = {"kind": "bounce", "detail": "The domain does not exist in DNS, so this address is unlikely to receive mail."}
    except dns.resolver.NoAnswer:
        # SMTP permits implicit MX: if no MX record exists, the domain's A/AAAA record may be used.
        try:
            hosts = []
            for record_type in ("A", "AAAA"):
                try:
                    answers = dns.resolver.resolve(domain, record_type, lifetime=DNS_TIMEOUT_SECONDS)
                    hosts.extend(str(answer) for answer in answers)
                except dns.resolver.NoAnswer:
                    pass
            if hosts:
                signal = {
                    "kind": "delivered",
                    "detail": "No MX record was found, but the domain has an address record that may support implicit mail routing. Mailbox existence and delivery are unconfirmed.",
                }
            else:
                signal = {"kind": "bounce", "detail": "No MX record or usable domain address record was found. The address is unlikely to receive mail."}
        except dns.resolver.NXDOMAIN:
            signal = {"kind": "bounce", "detail": "The domain does not exist in DNS, so this address is unlikely to receive mail."}
        except (dns.resolver.NoNameservers, dns.exception.Timeout, dns.resolver.LifetimeTimeout):
            signal = {"kind": "unknown", "detail": "DNS did not provide a reliable answer. The network or DNS provider may be blocking or timing out lookups."}
        except Exception:
            signal = {"kind": "unknown", "detail": "The domain's mail-routing status could not be determined reliably."}
    except (dns.resolver.NoNameservers, dns.exception.Timeout, dns.resolver.LifetimeTimeout):
        signal = {"kind": "unknown", "detail": "DNS did not provide a reliable answer. The network or DNS provider may be blocking or timing out lookups."}
    except Exception:
        signal = {"kind": "unknown", "detail": "The domain's mail-routing status could not be determined reliably."}

    cache[domain] = signal
    return signal


def check_email(raw_address: str, domain_cache: dict[str, dict]) -> dict:
    address = raw_address.strip()
    try:
        validated = validate_email(address, check_deliverability=False)
        normalized = validated.normalized
    except EmailNotValidError as exc:
        # The requested task has three categories; malformed addresses are placed in
        # Likely to Bounce, with an explicit explanation that this is a syntax result.
        return {
            "email": address,
            "status": "Likely to Bounce",
            "detail": f"Invalid email format: {str(exc)}",
            "kind": "bounce",
            "basis": "syntax",
        }

    domain = normalized.rsplit("@", 1)[1]
    signal = check_domain(domain, domain_cache)
    details = dict(signal)
    details.update({"email": address, "status": {"delivered": "Domain Configured", "bounce": "Likely to Bounce", "unknown": "Unknown"}[signal["kind"]], "basis": "domain"})
    return details


def parse_addresses(raw: str) -> list[str]:
    # Newline, comma and semicolon are supported; whitespace inside an address is preserved
    # so malformed values such as "user name@example.com" can be reported accurately.
    return [part.strip() for part in raw.replace(",", "\n").replace(";", "\n").splitlines() if part.strip()]


@app.get("/")
def index():
    return render_template("index.html", max_batch_size=MAX_BATCH_SIZE)


@app.post("/api/check")
def api_check():
    payload = request.get_json(silent=True) or {}
    raw = payload.get("emails", "")
    if not isinstance(raw, str):
        return jsonify({"error": "Please provide email addresses as text."}), 400

    addresses = parse_addresses(raw)
    if not addresses:
        return jsonify({"error": "Paste at least one email address to check."}), 400
    if len(addresses) > MAX_BATCH_SIZE:
        return jsonify({"error": f"This version supports up to {MAX_BATCH_SIZE} addresses per batch. Split larger lists into smaller batches."}), 400

    started = perf_counter()
    # Resolve each syntactically valid, unique domain once, concurrently. This avoids
    # serial DNS timeouts for large lists while keeping concurrency bounded.
    unique_domains: set[str] = set()
    for address in addresses:
        try:
            validated = validate_email(address, check_deliverability=False)
            unique_domains.add(validated.normalized.rsplit("@", 1)[1].rstrip(".").lower())
        except EmailNotValidError:
            continue

    domain_cache: dict[str, dict] = {}
    domains = sorted(unique_domains)
    if domains:
        with ThreadPoolExecutor(max_workers=min(20, len(domains))) as pool:
            signals = pool.map(lambda domain: (domain, check_domain(domain, {})), domains)
            domain_cache.update(signals)

    results = [check_email(address, domain_cache) for address in addresses]
    elapsed_ms = round((perf_counter() - started) * 1000)
    counts = {
        "total": len(results),
        "delivered": sum(item["kind"] == "delivered" for item in results),
        "bounce": sum(item["kind"] == "bounce" for item in results),
        "unknown": sum(item["kind"] == "unknown" for item in results),
    }
    counts["unique_domains"] = len(domain_cache)
    counts["duplicate_addresses"] = len(addresses) - len({item["email"].casefold() for item in results})
    return jsonify({"results": results, "counts": counts, "elapsed_ms": elapsed_ms})


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "This request is too large. The browser automatically splits runs into batches of 100 addresses; use the app input or import a file."}), 413


if __name__ == "__main__":
    # Debug mode is deliberately off by default for safer local use.
    app.run(host="127.0.0.1", port=5000, debug=False)
