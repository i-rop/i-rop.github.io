#!/usr/bin/env node
/*
 * Keeps the parts every page shares (common <head> tags, header/menu, footer) identical on all pages
 * and rewrites sitemap.xml.
 *
 *   node _tools/sync-chrome.mjs            update every page
 *   node _tools/sync-chrome.mjs --check    only report pages that are out of date (exit code 1)
 *
 * Pages mark the regions this script owns with comments, for example
 *     <!-- chrome:header --> ... <!-- /chrome:header -->
 * and everything outside those comments (title, description, page content) is never touched.
 * To change the menu or the footer, edit the NAV and FOOTER sections below, then run the script.
 * Needs Node 18 or newer. The _tools folder starts with an underscore, so GitHub Pages does not publish it.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://i-rop.github.io/';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NOT_PAGE_DIRS = new Set(['css', 'js', 'images', 'node_modules']);

/* ------------------------------------------------------------------ menu and footer links */

// The main menu, in order. Paths are relative to the site root; `cta: true` styles the button.
const NAV = [
    { href: 'cliniciansExamples.html', label: 'Clinician examples' },
    { href: 'cliniciansSeverityScale.html', label: 'Severity scale' },
    { href: 'people.html', label: 'People' },
    { href: 'publications.html', label: 'Publications' },
    { href: 'funding.html', label: 'Funding' },
    { href: 'risk-calculator/', label: 'Risk calculator', cta: true },
];

const FOOTER_COLUMNS = [
    { title: 'Resources', links: [
        { href: 'cliniciansExamples.html', label: 'Clinician examples' },
        { href: 'cliniciansSeverityScale.html', label: 'Severity scale' },
        { href: 'risk-calculator/', label: 'Risk calculator' },
    ] },
    { title: 'Consortium', links: [
        { href: 'people.html', label: 'People' },
        { href: 'publications.html', label: 'Publications' },
        { href: 'funding.html', label: 'Funding' },
    ] },
];

const FOOTER_BLURB =
    'The i-ROP consortium is led by Oregon Health &amp; Science University (OHSU) and has been funded by the National Institutes of Health since 2010.';

/* ------------------------------------------------------------------ templates */

const icon = {
    menu: '<svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const head = ({ root }) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d171c" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${root}favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<link rel="stylesheet" href="${root}css/site.css">
<script>document.documentElement.classList.add('js')</script>`;

const header = ({ root, path }) => `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
    <div class="container header-inner">
        <a class="brand" href="${root}index.html"${path === 'index.html' ? ' aria-current="page"' : ''}>
            <img class="brand-mark" src="${root}images/brand/irop-mark.jpg" width="40" height="40" alt="">
            <span class="brand-text">
                <span class="brand-name">i-ROP</span>
                <span class="brand-tag">Imaging and Informatics in Retinopathy of Prematurity</span>
            </span>
        </a>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
            <span class="visually-hidden">Menu</span>
            ${icon.menu}
            ${icon.close}
        </button>
        <nav class="site-nav" id="site-nav" aria-label="Main">
            <ul>
${NAV.map((item) => `                <li><a${item.cta ? ' class="nav-cta"' : ''} href="${root}${item.href}"${item.href === path ? ' aria-current="page"' : ''}>${item.label}</a></li>`).join('\n')}
            </ul>
        </nav>
    </div>
</header>`;

const footer = ({ root }) => `<footer class="site-footer">
    <div class="container">
        <div class="footer-grid">
            <div class="footer-brand">
                <img class="footer-logo" src="${root}images/brand/irop-logo.jpg" width="240" height="56" loading="lazy" alt="i-ROP: Imaging and Informatics in Retinopathy of Prematurity">
                <p>${FOOTER_BLURB}</p>
            </div>
${FOOTER_COLUMNS.map((col) => `            <nav aria-label="${col.title}">
                <h2>${col.title}</h2>
                <ul>
${col.links.map((link) => `                    <li><a href="${root}${link.href}">${link.label}</a></li>`).join('\n')}
                </ul>
            </nav>`).join('\n')}
        </div>
        <div class="footer-bottom">
            <p>&copy; ${new Date().getFullYear()} i-ROP</p>
            <p><a href="#">Back to top</a></p>
        </div>
    </div>
</footer>
<script src="${root}js/site.js" defer></script>`;

const REGIONS = { head, header, footer };

/* ------------------------------------------------------------------ pages */

// Every .html file in the site root, plus <folder>/index.html for each page that lives in its own folder.
// A page that contains <!-- chrome:none --> (for example a redirect page) is left alone and kept out of the sitemap.
function findPages() {
    const found = [];
    for (const name of readdirSync(ROOT)) {
        if (name.startsWith('.') || name.startsWith('_') || NOT_PAGE_DIRS.has(name)) { continue; }
        const full = join(ROOT, name);
        if (statSync(full).isFile() && name.endsWith('.html')) { found.push(name); }
        else if (statSync(full).isDirectory() && existsSync(join(full, 'index.html'))) { found.push(`${name}/index.html`); }
    }
    return found.filter((path) => !readFileSync(join(ROOT, path), 'utf8').includes('<!-- chrome:none -->')).sort();
}

// Links on 404.html must work from any URL depth, so that one page uses root-absolute paths.
function rootPrefix(path) {
    if (path === '404.html') { return '/'; }
    return '../'.repeat(path.split('/').length - 1);
}

// The path a menu item points to for this page: "risk-calculator/index.html" is the menu's "risk-calculator/".
const menuPath = (path) => path.replace(/index\.html$/, '') || 'index.html';

function sync(path) {
    const file = join(ROOT, path);
    const original = readFileSync(file, 'utf8');
    let html = original;
    const context = { root: rootPrefix(path), path: menuPath(path) };

    for (const [name, render] of Object.entries(REGIONS)) {
        const region = new RegExp(`(<!-- chrome:${name} -->)[\\s\\S]*?(<!-- /chrome:${name} -->)`);
        if (!region.test(html)) { throw new Error(`${path}: missing the <!-- chrome:${name} --> ... <!-- /chrome:${name} --> comments`); }
        html = html.replace(region, (_, open, close) => `${open}\n${render(context)}\n${close}`);
    }
    return { file, original, html };
}

/* ------------------------------------------------------------------ run */

const checkOnly = process.argv.includes('--check');
const pages = findPages();
const stale = [];

for (const path of pages) {
    const { file, original, html } = sync(path);
    if (html !== original) {
        stale.push(path);
        if (!checkOnly) { writeFileSync(file, html); }
    }
}

// Pages marked noindex (the 404 page, retired pages) are left out of the sitemap.
const isNoindex = (path) => /<meta name="robots" content="[^"]*noindex/i.test(readFileSync(join(ROOT, path), 'utf8'));

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
    .filter((path) => !isNoindex(path))
    .map((path) => `    <url><loc>${SITE}${path === 'index.html' ? '' : path.replace(/index\.html$/, '')}</loc></url>`)
    .join('\n')}
</urlset>
`;
const sitemapFile = join(ROOT, 'sitemap.xml');
const sitemapStale = !existsSync(sitemapFile) || readFileSync(sitemapFile, 'utf8') !== sitemap;
if (sitemapStale) {
    stale.push('sitemap.xml');
    if (!checkOnly) { writeFileSync(sitemapFile, sitemap); }
}

if (checkOnly) {
    console.log(stale.length ? `Out of date: ${stale.join(', ')}\nRun: node _tools/sync-chrome.mjs` : `All ${pages.length} pages and the sitemap are up to date.`);
    process.exit(stale.length ? 1 : 0);
}
console.log(stale.length ? `Updated: ${stale.join(', ')}` : `Nothing to change (${pages.length} pages already up to date).`);
