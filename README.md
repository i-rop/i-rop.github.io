# i-ROP website

Source for <https://i-rop.github.io>, the site of the Imaging and Informatics in Retinopathy of Prematurity (i-ROP) consortium.

It is a plain static site served by GitHub Pages: **no framework and no build step**. Every page is an ordinary HTML file you can edit in any text editor or in GitHub's web editor, and a push to the default branch publishes it.

## What is where

```
index.html, people.html, publications.html, funding.html, ...   the pages (the URLs have not changed)
risk-calculator/        the 2-week TR-ROP risk calculator: index.html, model.js (the model), calculator.js, calculator.css
css/site.css            all the styling (colours and sizes are the variables at the top)
js/site.js              mobile menu and the click-to-enlarge image viewer
images/                 people/  team/  examples/  SeverityScale/  brand/
home.html               an old address; it just redirects to the home page
404.html, robots.txt, sitemap.xml, favicon.ico, apple-touch-icon.png
_tools/                 helper scripts, described below
```

## Test before you publish

You need [Node](https://nodejs.org) 18 or newer (`node --version` tells you). Run these from this folder. None of them changes the site, except where it says so.

**1. Look at it.**

```
node _tools/serve.mjs
```

then open <http://localhost:8000>. Stop it with Ctrl+C; add `--port 9000` to use another port. It serves the site the way GitHub Pages does, which opening the files directly (`file://`) or `python3 -m http.server` does not:

- file names are case-sensitive, so `Images/Logo.JPG` is a 404 here when the file is `images/logo.jpg`, exactly as it would be on the live site (a Mac would quietly accept it);
- `/people` opens `people.html`, `/risk-calculator` redirects to `/risk-calculator/`, and an unknown address shows `404.html`;
- `_tools/` and other folders starting with `.` or `_` are not served;
- nothing is cached, so a refresh always shows your latest edit.

Every request is printed in the terminal and anything that is not a 200 is coloured, so a missing picture or a wrong-case name shows up immediately.

**2. Check it.** In a second terminal window:

```
node _tools/check-site.mjs
```

This takes about a second and works offline. It reports links, pictures and "#section" jumps that lead nowhere (including wrong capitalisation), tags that are never closed, repeated ids, a missing title, description or canonical address, skipped heading levels, pictures without alt text, links, buttons and form fields without a name, a PubMed ID listed twice, pictures that are too heavy or not used by any page, a header or footer that is out of step with the shared one, and files that git spells differently from your disk. Errors must be fixed before publishing (the script exits with code 1); warnings are advice.

`node _tools/check-site.mjs --external` also visits every outside web address (needs internet, takes a minute or two). Dead links are errors. Websites that refuse automated visitors (a 403) are warnings: open those in a browser to be sure.

**3. Click through it.** A checker cannot judge how a page looks. Before a big change, open each menu item, click a severity-scale picture (it should enlarge, and Esc should close it), try the risk calculator, and look at a page at phone width (in Chrome or Safari: right-click, Inspect, then the device toolbar) and in dark mode (your system setting).

## Common edits

**Add a person.** In `people.html`, copy one `<li class="person">` block into the right group, change the name, role and organisation, and upload the photo to `images/people/`. A JPEG about 300 pixels wide is plenty. No photo? use `images/people/placeholder.png`. Leave `alt=""` on the photo, because the name is already next to it. To remove a link, delete the `<a>` tag and keep the name.

**Add a publication.** The easy way is the importer below. By hand, copy one `<li class="pub">` block in `publications.html` into the right year (newest first) and change the text. The link is `https://pubmed.ncbi.nlm.nih.gov/<PMID>/`. For a new year, copy a whole `<h2 class="pubs-year">` plus `<ul class="pubs">` pair and add a matching chip at the top of the page.

**Add or change a page.** Copy an existing page (for example `funding.html`), change the `<title>`, description and `<main>` content, and keep the `<!-- chrome:... -->` comment pairs, then run `node _tools/sync-chrome.mjs` (below). A page in its own folder (like `risk-calculator/index.html`) works too.

**Images.** Resize before uploading. Photos around 1600 pixels wide and JPEG are plenty (roughly 100 to 300 KB); a multi-megabyte upload slows the page for everyone, and `check-site.mjs` warns about it. Always set `alt` text on pictures that carry information, and `alt=""` on decoration. Keep file names lower-case without spaces, and never add a file whose name differs from an existing one only by capitalisation.

## Keep the publication list current

```
node _tools/import-publications.mjs --dry-run    # show what is new on PubMed, change nothing
node _tools/import-publications.mjs              # add it to publications.html
```

The importer asks PubMed (NCBI's public service, no account needed) for papers about retinopathy of prematurity by the core investigators, or that name the consortium, and adds the ones that are not on the page yet, in the right year, newest first. Entries already on the page are never changed or moved, and running it twice adds nothing the second time. A paper is kept if it names the i-ROP consortium; or ROP is in its title or a main topic and a core investigator is an author; or it mentions ROP and at least two core investigators are authors. The rule and the list of core investigators are at the top of the script, and are easy to change.

- Only papers from 2021 onwards are imported, because the older list was curated by hand. `--from 2015` looks further back.
- `--add 12345678` adds one paper by its PubMed ID whatever the rule says; `--verbose` also lists the papers it left out.
- To keep a paper off the page for good, put its PubMed ID on its own line in `_tools/publications-ignore.txt` (create the file; `#` starts a comment).
- Look at the result (`git diff publications.html`) and run `node _tools/check-site.mjs` before you commit.

## The shared header and footer

The menu, header and footer are the same on every page. They live in one place, `_tools/sync-chrome.mjs`, and are copied into each page between the `<!-- chrome:... -->` comments. To change the menu or footer, edit that script and run:

```
node _tools/sync-chrome.mjs          # rewrites those comment blocks on every page, and sitemap.xml
node _tools/sync-chrome.mjs --check  # only reports pages that are out of date
```

Nothing outside the comment blocks is touched, so you can edit page content freely. Skip this tool entirely if you are only editing content (`check-site.mjs` will tell you if something is out of step).

## The risk calculator

`risk-calculator/model.js` is a JavaScript port of the R Shiny app that used to be hosted on shinyapps.io; it contains the coefficients, the 0.008 threshold, and the rounding and age rules. It was checked against the original R code for every valid combination of inputs (91,791 of them) and the results matched exactly. If the model is ever refit, `model.js` is the only file that changes; please re-check it against the new R code before publishing. Everything runs in the visitor's browser, so no patient values leave the device.

## Notes

- The 2026 redesign replaced Bootstrap 3, jQuery and the JavaScript-built menu with plain HTML and CSS, and cut the images from about 80 MB to about 6 MB. The previous version and the original full-size photos are in this repository's git history from before the redesign.
- The **i-ROP ASSIST** mobile app is no longer active, so its support page, privacy policy, store badges and footer link were removed (they are in git history if ever needed).
- Profile links on the People page that no longer worked were removed, and each original address is kept in an HTML comment next to the name (search for `link removed`).
- The Study PI is J. Peter Campbell, MD, MPH.
