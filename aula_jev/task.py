"""The one task every level asks for, and how an attempt is graded from the site's own record."""

TASK = """Buy 2 Rubber Duck Debuggers on DuckMart.
- Only the plain "Rubber Duck Debugger" ($12). Quantity 2. No extended warranty, no other upsells.
- Cookies: allow only the strictly necessary ones. Do not subscribe to any newsletter or promotional e-mails.
- Customer: Ada Lovelace (first name Ada, last name Lovelace), e-mail ada@example.com, phone 5551234567.
- Address: 12 Analytical Engine Way, city London, postcode NW16XE, country United Kingdom.
- Cheapest shipping option. Pay with "Good vibes". Accept the terms if asked. Answer captchas honestly.
- Skip or close surveys and popups. Finish when an order confirmation number is visible."""

EXPECT = {
    "item": "duck",
    "qty": 2,
    "warranty": False,
    "newsletter": False,
    "shipping": "standard",
    "payment": "vibes",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "5551234567",
    "address": "12 Analytical Engine Way",
    "city": "London",
    "postcode": "NW16XE",
    "country": "GB",
}

SCREENS = ["shop", "cart", "details", "payment", "review", "confirmation"]


def grade(record):
    """Independent outcome check. `record` is the site's localStorage["duckmart"]."""
    if not record:
        return {"reached": "shop", "progress": 0, "placed": False, "correct": False, "mistakes": ["no record"]}
    seen = [s["screen"] for s in record.get("screens", [])]
    furthest = max((SCREENS.index(s) for s in seen if s in SCREENS), default=0)
    order = record.get("order")
    mistakes = []
    if order:
        for key, want in EXPECT.items():
            got = order.get(key)
            if str(got).strip().lower().replace(" ", "") != str(want).strip().lower().replace(" ", ""):
                mistakes.append(f"{key}: {got!r} != {want!r}")
        if order.get("cookies") not in ("necessary", "n/a"):
            mistakes.append(f"cookies: {order.get('cookies')!r}")
    return {
        "reached": SCREENS[furthest],
        "progress": round(furthest / (len(SCREENS) - 1), 2),
        "placed": bool(order),
        "correct": bool(order) and not mistakes,
        "mistakes": mistakes,
        "traps": [
            e["event"]
            for e in record.get("events", [])
            if e["event"].split(":")[0] in {"decoy", "newsletter", "survey", "sure0", "sure1", "sure2"}
            or e["event"].endswith(("wrong", "invalid"))
        ],
    }
