"""Finds every R&M Magazine issue uploaded to realtynmore.com and makes its cover.

Writes public/data/magazine.json and public/magazine/<id>.jpg (first page of each issue).
Runs locally and in the GitHub Actions build; issues that already have a cover are not
downloaded again, so a new issue uploaded to the website appears in the app on the next build.
Nothing is changed on the website; it only reads the public media list and the PDFs.
"""
import json
import os
import re
import sys
import tempfile
import urllib.request

API = "https://realtynmore.com/wp-json/wp/v2/media"
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT_JSON = os.path.join(ROOT, "public", "data", "magazine.json")
OUT_DIR = os.path.join(ROOT, "public", "magazine")
UA = {"User-Agent": "Mozilla/5.0 (compatible; RM-News-App/1.0)"}

MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
QUARTER = re.compile(rf"({MONTHS})[\s_-]+({MONTHS})[\s_-]+(\d{{4}})", re.I)
# Older single-month issues and special editions, identified by their upload ids on the website.
# Checked against each cover on 2026-10-26.
OLDER = {
    91933: ("December 2019", "2019-12"),
    91931: ("March 2020", "2020-03"),
    52504: ("September 2020 · 7th Anniversary", "2020-09"),
}
# Same issue uploaded twice: the duplicate is left out (91932 = 52504 at 175 MB; 110598 = 110600).
DUPLICATES = {91932, 110598}
# Special issues whose title is on the cover, not in the file name.
NAMED = {107979: "12th Anniversary Special"}
SPECIAL = re.compile(r"special", re.I)
SKIP = re.compile(r"podium|presentation|banner|feeler|logo|report|tracker|watch", re.I)
MONTH_NO = {m.lower(): i for i, m in enumerate(MONTHS.split("|"), 1)}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def all_pdfs():
    out, page = [], 1
    while True:
        try:
            batch = get_json(f"{API}?mime_type=application/pdf&per_page=100&page={page}&_fields=id,date,title,source_url,media_details")
        except Exception:
            break
        if not batch:
            break
        out += batch
        page += 1
    return out


def clean(t):
    return re.sub(r"&#0?38;", "&", re.sub(r"<[^>]+>", "", t or "")).strip()


def classify(m):
    """(title, period 'YYYY-MM', kind) for a magazine issue, or None."""
    if m["id"] in DUPLICATES:
        return None
    if m["id"] in OLDER:
        title, period = OLDER[m["id"]]
        return title, period, "archive"
    t = clean(m["title"]["rendered"])
    name = m["source_url"].rsplit("/", 1)[-1]
    if SKIP.search(t):
        return None
    q = QUARTER.search(t) or QUARTER.search(name.replace("-", " "))
    if q and ("R&M" in t or name.lower().startswith(("rm", "jacket_rm"))):
        first, last, year = q.group(1).title(), q.group(2).title(), q.group(3)
        return f"{first}–{last} {year}", f"{year}-{MONTH_NO[last.lower()]:02d}", "quarterly"
    if SPECIAL.search(t) or SPECIAL.search(name):
        up = m["date"][:7]
        label = "Special Issue" if "special issue" in t.lower() else "Special Edition"
        return NAMED.get(m["id"], f"{label} ({up[:4]})"), up, "special"
    return None


def file_size(url):
    try:
        req = urllib.request.Request(url, headers=UA, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get("Content-Length") or 0)
    except Exception:
        return 0


def cover_and_pages(url, dest):
    import pypdfium2 as pdfium
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                tmp.write(chunk)
        path = tmp.name
    try:
        pdf = pdfium.PdfDocument(path)
        pages = len(pdf)
        page = pdf[0]
        img = page.render(scale=560 / page.get_width()).to_pil().convert("RGB")
        img.save(dest, quality=82, optimize=True, progressive=True)
        pdf.close()
        return pages
    finally:
        os.unlink(path)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    try:
        previous = {i["id"]: i for i in json.load(open(OUT_JSON, encoding="utf-8")).get("issues", [])}
    except Exception:
        previous = {}
    pdfs = all_pdfs()
    if not pdfs:
        print("  magazine: website list unavailable, kept previous copy")
        return
    # One entry per issue: the newest upload wins (re-uploads fix typos or quality).
    best = {}
    for m in pdfs:
        c = classify(m)
        if not c:
            continue
        title, period, kind = c
        key = (title, kind)
        if key not in best or m["id"] > best[key][0]["id"]:
            best[key] = (m, title, period, kind)
    issues = []
    for m, title, period, kind in best.values():
        cover = os.path.join(OUT_DIR, f"{m['id']}.jpg")
        pages = previous.get(m["id"], {}).get("pages")
        if not os.path.exists(cover) or not pages:
            try:
                pages = cover_and_pages(m["source_url"], cover)
                print(f"  magazine: cover for {title} ({pages} pages)")
            except Exception as e:
                print(f"  magazine: skipped {title} ({e})")
                continue
        size = (m.get("media_details") or {}).get("filesize") or previous.get(m["id"], {}).get("bytes") or file_size(m["source_url"])
        issues.append({"id": m["id"], "title": title, "period": period, "kind": kind, "uploaded": m["date"][:10], "pages": pages, "bytes": size, "url": m["source_url"], "cover": f"magazine/{m['id']}.jpg"})
    issues.sort(key=lambda i: (i["period"], i["uploaded"]), reverse=True)
    json.dump({"generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "issues": issues}, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  magazine: {len(issues)} issues")


if __name__ == "__main__":
    sys.exit(main())
