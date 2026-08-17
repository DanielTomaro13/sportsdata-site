# sportsdata-site

Static marketing site for **sportsdata-ai.com** (playback mode — no backend), served from
GitHub Pages. Source of truth for the product pages lives in the private product repo;
publish updates with its `scripts/deploy-site.sh`.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Home page. Tool catalogue browser, recorded demo, FAQ, download. |
| `engines.html` | **Generated** — do not edit by hand. Run `python3 scripts/build_engines_page.py`. |
| `board/`, `sports/` | The two live board terminals (replay mode from `*/data/`). |
| `search.html` | Site search — indexes the page list plus `catalogue.json`. |
| `sitemap.html` | Human-readable sitemap. |
| `thanks.html` | Post-download landing page with install steps. Linked from the download CTA. |
| `404.html` | Custom 404 (GitHub Pages serves this automatically). |
| `maintenance.html` | Standalone placeholder. Not linked; swap in manually if ever needed. |
| `terms.html`, `privacy.html`, `accessibility.html` | Legal and compliance pages. |
| `assets/` | Favicon set and the Open Graph share card. |

## SEO files

`robots.txt`, `sitemap.xml`, `site.webmanifest` and `llms.txt` live at the root.
`.nojekyll` stops GitHub Pages running the files through Jekyll.

**When you add or remove a page**, update all four of these:

1. `sitemap.xml` — add the `<url>` entry and bump `<lastmod>`.
2. `sitemap.html` — add the human-facing row.
3. `search.html` — add an entry to the `PAGES` array so site search can find it.
4. `llms.txt` — add it under `## Pages`.

Every indexable page carries a `<link rel="canonical">`, Open Graph and Twitter card tags,
and JSON-LD (`BreadcrumbList` on subpages; `WebSite` / `Organization` /
`SoftwareApplication` / `FAQPage` on the home page). Utility pages (`404`, `search`,
`thanks`, `maintenance`) are `noindex, follow` rather than blocked in `robots.txt`, so
crawlers can actually see the directive.

The home-page FAQ markup and the `FAQPage` JSON-LD must stay in sync — Google requires the
answers to be visible on the page.

## Regenerating assets

The share card and icons were rendered from SVG with macOS `qlmanage` + `sips`:

```
qlmanage -t -s 1200 -o . icon.svg && sips -Z 180 icon.svg.png --out assets/apple-touch-icon.png
```

`assets/og-cover.jpg` is 1200×630. Keep those dimensions — they're declared in the meta tags.

## Support links

Ko-fi (`ko-fi.com/danieltomaro`) is linked from every page footer, the `#get` section, the
thank-you page and `.github/FUNDING.yml`. Two rules the copy follows deliberately:

- The ask never reads as a condition of the download. On the home page it sits in its own note
  *above* the legal one, and says "both are free forever" first.
- `terms.html` §3 and `privacy.html` §1 state that a donation is a voluntary gift that unlocks
  nothing and gates nothing, and that Ko-fi handles payment so we never see card details.
  Keep those in sync if the funding setup changes.

## Analytics & consent

`window.ANALYTICS_URL` in `index.html` is `null`, so no analytics script loads and no cookies
are set. Setting it to a GoatCounter endpoint activates a consent banner; the script only
loads after the visitor accepts, and the choice is stored in `localStorage`, not a cookie.
If you enable it, check `privacy.html` §6 still describes what actually happens.
