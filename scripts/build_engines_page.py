#!/usr/bin/env python3
"""Render engines.html from engines.json, in the site's own visual language.

The split is deliberate. ``sportsdata-engines`` produces the DATA — it measures
its own coverage by pricing real boards through the same entry point the API
serves, and writes ``engines.json``. This script owns nothing but presentation,
so the engine package never learns about the site's markup, colours or layout,
and the site never imports the engine.

Regenerate whenever the engine ships markets:

    cd ../sportsdata-engines && .venv/bin/python -c \
      "from sportsdata_engines.showcase import showcase_data, pathlib; ..."
    python3 scripts/build_engines_page.py

The page is static: no fetch, no JavaScript, nothing to fail at load. That
matters because the whole point of generating it is that it cannot go stale
quietly — a page that renders "loading…" when a fetch fails is exactly the rot
this replaces.
"""

from __future__ import annotations

import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "engines.json"
OUT = ROOT / "engines.html"

STATUS_LABEL = {
    "implemented": "priced",
    "blocked": "needs a feed",
    "missing": "not built",
}


def chip(status: str, item: str) -> str:
    return (f'<span class="chip {html.escape(status)}" title="{STATUS_LABEL[status]}">'
            f"{html.escape(item)}</span>")


PRETTY = {
    "h2h": "head to head", "h2h_3way": "3-way", "line": "line / handicap",
    "total": "total points", "team_total_home": "home team total",
    "team_total_away": "away team total", "margin_bands": "winning margin",
    "btts": "both teams to score", "exact": "exact score", "race": "race to N",
    "correct_score": "correct score", "double_chance": "double chance",
    "scoreless": "scoreless period", "particular_score": "first score type",
    "winner": "head to head", "handicap": "line / handicap",
    "team_total": "team totals", "both_team": "both teams to score",
    "first_half": "first half", "period": "by quarter / half",
    "pra": "points + rebounds + assists", "saves_gk": "saves (GK)",
}


def label(item: str) -> str:
    return PRETTY.get(item, item.replace("_", " "))


def stat_block(node: dict) -> str:
    """Real stat NAMES, grouped by who they belong to.

    "player markets: under_over, composite" is a shape, not a capability. A
    reader wants to know whether it prices DISPOSALS.
    """
    stats = node.get("stats") or []
    if not stats:
        return ""
    out = []
    for entity, heading in (("player", "Player stats"),
                            ("team", "Team stats"),
                            ("match", "Match stats")):
        group = [s for s in stats if s["entity"] == entity]
        if not group:
            continue
        chips = "".join(chip(s["status"], label(s["stat"])) for s in group)
        out.append(f'<h4>{heading} <span class="n">{len(group)}</span></h4>'
                   f'<div class="chips">{chips}</div>')
    return "".join(out)


def sport_card(node: dict) -> str:
    name = html.escape(node["sport"].replace("_", " "))
    bits = [f'<b>{node["implemented"]}</b> priced']
    if node["blocked"]:
        bits.append(f'{node["blocked"]} awaiting a feed')
    if node["missing"]:
        bits.append(f'{node["missing"]} not built')
    out = [f'<article class="sport"><h3>{name}</h3>',
           f'<p class="counts">{" · ".join(bits)}</p>']
    families = node["team_families"]
    if families:
        chips = "".join(chip(e["status"], label(e["item"])) for e in families)
        out.append(f'<h4>Match markets <span class="n">{len(families)}</span></h4>'
                   f'<div class="chips">{chips}</div>')
    out.append(stat_block(node))
    periods = [p for p in node["stat_periods"] if p["status"] == "implemented"]
    if periods:
        chips = "".join(chip(p["status"], label(p["item"])) for p in periods)
        out.append(f'<h4>Scoped to <span class="n">{len(periods)}</span></h4>'
                   f'<div class="chips">{chips}</div>')
    out.append("</article>")
    return "".join(out)


def example_table(rows: list[dict]) -> str:
    if not rows:
        return ""
    body = []
    for row in rows:
        line = "" if row["line"] is None else f' @ {row["line"]:g}'
        odds = "—" if row["odds"] is None else f'${row["odds"]:.2f}'
        err = "—" if row["std_error"] is None else f'±{row["std_error"]:.4f}'
        body.append(
            "<tr>"
            f'<td><code>{html.escape(row["market"])}</code>'
            f'<span class="note">{html.escape(row["note"])}</span></td>'
            f'<td>{html.escape(str(row["selection"]))}{html.escape(line)}</td>'
            f'<td class="num">{row["probability"]:.4f}</td>'
            f'<td class="num">{odds}</td>'
            f'<td class="num dimmed">{err}</td></tr>'
        )
    return ('<div class="tablewrap"><table><thead><tr>'
            "<th>Market</th><th>Selection</th><th class='num'>Fair probability</th>"
            "<th class='num'>Fair odds</th><th class='num'>Sampling error</th>"
            f"</tr></thead><tbody>{''.join(body)}</tbody></table></div>")


def render(data: dict) -> str:
    totals = data["totals"]
    stats = [("Markets priced", totals.get("implemented", 0)),
             ("Sports", len(data["sports"])),
             ("Awaiting a feed", totals.get("blocked", 0)),
             ("Not built", totals.get("missing", 0))]
    tiles = "".join(
        f'<div class="stat"><b>{v}</b><span>{html.escape(k)}</span></div>'
        for k, v in stats)
    cards = "".join(sport_card(s) for s in data["sports"])

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pricing Engines — {totals.get('implemented', 0)} Markets, {len(data['sports'])} Sports | sportsdata</title>
<meta name="description" content="What the sportsdata pricing engines can price: {totals.get('implemented', 0)} betting markets across {len(data['sports'])} sports, with published sampling error. Measured from the engines themselves, not claimed.">
<link rel="canonical" href="https://sportsdata-ai.com/engines.html">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="theme-color" content="#05080f">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="sportsdata">
<meta property="og:url" content="https://sportsdata-ai.com/engines.html">
<meta property="og:title" content="Pricing Engines — {totals.get('implemented', 0)} markets across {len(data['sports'])} sports">
<meta property="og:description" content="Simulation-based pricing for team, player and period markets, with published sampling error. Every figure generated from the engines themselves.">
<meta property="og:image" content="https://sportsdata-ai.com/assets/og-cover.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Pricing Engines — {totals.get('implemented', 0)} markets across {len(data['sports'])} sports">
<meta name="twitter:description" content="Simulation-based pricing for team, player and period markets, with published sampling error.">
<meta name="twitter:image" content="https://sportsdata-ai.com/assets/og-cover.jpg">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {{ "@type": "ListItem", "position": 1, "name": "Home", "item": "https://sportsdata-ai.com/" }},
    {{ "@type": "ListItem", "position": 2, "name": "Pricing engines", "item": "https://sportsdata-ai.com/engines.html" }}
  ]
}}
</script>
<style>
:root {{
  --bg:#05080f; --ink:#eef2ff; --dim:#8e97b3;
  --card:rgba(255,255,255,.035); --card-border:rgba(255,255,255,.08);
  --acc1:#6e8bff; --acc2:#3dd6f5; --acc3:#7cf5c8; --ok:#4ade80;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--ink);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif; }}
.grid-bg {{ position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:64px 64px; }}
main {{ position:relative; z-index:1; max-width:1060px; margin:0 auto; padding:28px 20px 80px; }}
nav {{ display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:48px; }}
.wordmark {{ font-weight:700; letter-spacing:-.02em; font-size:19px; }}
.wordmark span {{ background:linear-gradient(90deg,var(--acc1),var(--acc2));
  -webkit-background-clip:text; background-clip:text; color:transparent; }}
nav a {{ color:var(--dim); text-decoration:none; font-size:14px; }}
nav a:hover {{ color:var(--ink); }}
h1 {{ font-size:clamp(30px,5vw,46px); line-height:1.1; letter-spacing:-.03em; margin:0 0 14px; }}
h1 .grad {{ background:linear-gradient(90deg,var(--acc1) 0%,var(--acc2) 45%,var(--acc3) 90%);
  -webkit-background-clip:text; background-clip:text; color:transparent; }}
.sub {{ color:var(--dim); max-width:60ch; margin:0 0 30px; }}
h2 {{ font-size:20px; letter-spacing:-.01em; margin:56px 0 6px; }}
h3 {{ font-size:15px; margin:0 0 4px; text-transform:capitalize; letter-spacing:-.01em; }}
h4 {{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim);
  margin:14px 0 6px; font-weight:600; }}
.lede {{ color:var(--dim); max-width:66ch; margin:0 0 22px; font-size:15px; }}
.stats {{ display:flex; flex-wrap:wrap; gap:12px; margin:26px 0 8px; }}
.stat {{ flex:1 1 150px; background:var(--card); border:1px solid var(--card-border);
  border-radius:14px; padding:14px 16px; }}
.stat b {{ display:block; font-size:30px; line-height:1.15; letter-spacing:-.02em; }}
.stat span {{ color:var(--dim); font-size:12.5px; }}
.grid {{ display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }}
.sport {{ background:var(--card); border:1px solid var(--card-border);
  border-radius:14px; padding:16px 18px; }}
.counts {{ margin:0; color:var(--dim); font-size:13px; }}
.chips {{ display:flex; flex-wrap:wrap; gap:5px; }}
.chip {{ font-size:11.5px; padding:3px 9px; border-radius:999px; white-space:nowrap;
  font-family:var(--mono); background:rgba(255,255,255,.05); color:var(--dim); }}
.chip.implemented {{ background:rgba(74,222,128,.12); color:var(--ok); }}
.chip.blocked {{ background:rgba(245,196,61,.12); color:#f5c43d; }}
h4 .n {{ color:var(--dim); font-weight:400; letter-spacing:0; }}
.tablewrap {{ overflow-x:auto; border:1px solid var(--card-border); border-radius:14px;
  background:var(--card); }}
table {{ border-collapse:collapse; width:100%; font-size:14px; }}
th,td {{ text-align:left; padding:11px 14px; border-bottom:1px solid var(--card-border); }}
tbody tr:last-child td {{ border-bottom:0; }}
th {{ font-size:11px; letter-spacing:.07em; text-transform:uppercase; color:var(--dim); font-weight:600; }}
.num {{ text-align:right; font-variant-numeric:tabular-nums; font-family:var(--mono); }}
.dimmed {{ color:var(--dim); }}
code {{ font-family:var(--mono); font-size:12.5px; color:var(--acc2); }}
.note {{ display:block; color:var(--dim); font-size:12px; margin-top:2px; }}
.legend {{ display:flex; gap:16px; flex-wrap:wrap; color:var(--dim); font-size:13px; margin:0 0 18px; }}
.legend b {{ font-weight:600; }}
footer {{ margin-top:64px; padding-top:20px; border-top:1px solid var(--card-border);
  color:var(--dim); font-size:13px; display:flex; gap:16px; flex-wrap:wrap; justify-content:space-between; }}
footer a {{ color:var(--dim); }}
@media (max-width:560px) {{ .stat b {{ font-size:24px; }} }}
</style>
</head>
<body>
<div class="grid-bg"></div>
<main>
  <nav>
    <a class="wordmark" href="/" style="text-decoration:none;color:var(--ink)">sports<span>data</span></a>
    <div style="display:flex;gap:18px;flex-wrap:wrap">
      <a href="/#feeds">Tools</a>
      <a href="/board/">Racing board</a>
      <a href="/sports/">Sports board</a>
      <a href="/">← back to sportsdata</a>
    </div>
  </nav>

  <p class="crumbs" style="font-size:13px;color:#62748f;margin:-28px 0 22px">
    <a href="/" style="color:var(--dim);text-decoration:none">Home</a> ›
    <span aria-current="page">Pricing engines</span></p>

  <h1>Pricing engines.<br><span class="grad">{totals.get('implemented', 0)} markets, {len(data['sports'])} sports.</span></h1>
  <p class="sub">Simulation-based pricing for team, player and period markets —
  head-to-head through to "first scorer in both halves". Every figure below is
  generated from the engines themselves, not written by hand.</p>

  <div class="stats">{tiles}</div>

  <h2>A fixture, priced</h2>
  <p class="lede">One real AFL board. The <b>sampling error</b> column is published
  on purpose: these are simulated prices, and a difference smaller than the error
  bar is noise, not edge — so you can see exactly how much confidence each number
  carries.</p>
  {example_table(data["example"])}

  <h2>Coverage by sport</h2>
  <p class="lede">Every stat below is priced as a full over/under ladder and, where
  the sport has periods, per quarter or half as well — so "disposals" means
  <code>25.5+ disposals</code>, <code>first-half disposals</code>, and the
  multi-player and same-game combinations built on them.</p>
  <p class="legend">
    <span><b class="chip implemented" style="display:inline-block">priced</b> available today</span>
    <span><b class="chip blocked" style="display:inline-block">needs a feed</b> modelled, waiting on data</span>
    <span><b class="chip" style="display:inline-block">not built</b> not yet</span>
  </p>
  <div class="grid">{cards}</div>

  <footer>
    <span>Market vocabulary v{html.escape(str(data['vocabulary_version']))} ·
    generated from the coverage report · informational only, not betting advice · 18+</span>
    <span><a href="/">Home</a> · <a href="/sitemap.html">Sitemap</a> ·
    <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> ·
    <a href="https://ko-fi.com/danieltomaro" target="_blank" rel="noopener">Support on Ko-fi ☕</a> ·
    <a href="https://github.com/DanielTomaro13/sportsdata-mcp">GitHub ↗</a></span>
  </footer>
</main>
<!-- Cloudflare Web Analytics. The token is a PUBLIC site identifier, not a
     secret — it ships in the HTML of every page by design. Privacy-preserving: no
     cookies, no fingerprinting, no cross-site tracking, which is why privacy.html
     does not need a cookie banner. -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{{"token": "5740db870bb34d4b844d2a9d8cce3455"}}'></script>
</body>
</html>
"""


def main() -> None:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    OUT.write_text(render(data), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
