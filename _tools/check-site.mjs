#!/usr/bin/env node
/*
 * Checks the whole site for mistakes before you publish. Nothing is changed, and no browser is needed.
 *
 *   node _tools/check-site.mjs               check everything (takes about a second, works offline)
 *   node _tools/check-site.mjs --external    also visit every outside web address (needs internet, takes a minute or two)
 *
 * It looks for:
 *   - links, pictures, scripts, stylesheets and "#section" jumps that lead nowhere, including wrong capitalisation
 *     (a Mac accepts "Images/Logo.JPG" for "images/logo.jpg", GitHub Pages does not);
 *   - broken page structure: tags that are never closed, repeated ids, a missing title or description,
 *     a missing or doubled main heading, skipped heading levels;
 *   - accessibility basics: pictures without alt text, links or buttons with no readable name, unlabeled form fields;
 *   - the same PubMed ID listed twice on the publications page;
 *   - a header, menu, footer or sitemap that is out of step with _tools/sync-chrome.mjs;
 *   - pictures too heavy for a fast page, and files that git spells differently from your disk.
 * Errors mean "fix before publishing" and make the script exit with code 1. Warnings are advice and never fail the run.
 * Every tag is expected to be closed explicitly (</li>, </p>), as the pages in this site do.
 * Needs Node 18 or newer. The _tools folder starts with an underscore, so GitHub Pages does not publish it.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OWN_SITE = /^https?:\/\/i-rop\.github\.io(?=\/|$)/i;
const SITE = 'https://i-rop.github.io/';
const MAX_DESCRIPTION = 175;
const MAX_IMAGE_BYTES = 500 * 1024;
const WEB_IMAGES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif', '.ico']);

const options = process.argv.slice(2);
if (options.includes('--help') || options.includes('-h')) {
    console.log('Usage: node _tools/check-site.mjs [--external]\n  --external   also visit every outside web address (needs internet)');
    process.exit(0);
}
const unknownOptions = options.filter((option) => option !== '--external');
if (unknownOptions.length) {
    console.error(`Unknown option: ${unknownOptions.join(' ')}\nUsage: node _tools/check-site.mjs [--external]`);
    process.exit(2);
}
const CHECK_EXTERNAL = options.includes('--external');

const color = process.stdout.isTTY
    ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' }
    : { red: '', yellow: '', green: '', bold: '', dim: '', reset: '' };

const findings = [];
const error = (file, message, line) => findings.push({ file, severity: 'error', message, line });
const warn = (file, message, line) => findings.push({ file, severity: 'warning', message, line });

/* ------------------------------------------------------------------ files */

const listings = new Map();
function names(dir) {
    if (!listings.has(dir)) { listings.set(dir, readdirSync(dir)); }
    return listings.get(dir);
}

// Finds a file from its path inside the site, matching capitalisation exactly (as GitHub Pages does; same rule as serve.mjs).
// Returns { path } when found, { caseHint } (the correctly capitalised path) when only the capitalisation is wrong, or {}.
function locate(relative) {
    const segments = relative.split('/').filter(Boolean);
    const actual = [];
    let current = ROOT;
    for (const segment of segments) {
        if (!statSync(current).isDirectory()) { return {}; }
        const all = names(current);
        const name = all.includes(segment) ? segment : all.find((candidate) => candidate.toLowerCase() === segment.toLowerCase());
        if (!name) { return {}; }
        actual.push(name);
        current = join(current, name);
    }
    return actual.every((name, index) => name === segments[index]) ? { path: current } : { caseHint: actual.join('/') };
}

// Every file the site publishes: nothing inside dot-folders or underscore-folders (such as _tools), as on GitHub Pages.
function walk(dir = '') {
    const found = [];
    for (const name of names(join(ROOT, dir))) {
        if (name.startsWith('.') || name.startsWith('_') || name === 'node_modules') { continue; }
        const relative = dir ? `${dir}/${name}` : name;
        if (statSync(join(ROOT, relative)).isDirectory()) { found.push(...walk(relative)); } else { found.push(relative); }
    }
    return found;
}

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

function lineLookup(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 10) { starts.push(i + 1); } }
    return (offset) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) { low = middle; } else { high = middle - 1; }
        }
        return low + 1;
    };
}

/* ------------------------------------------------------------------ reading a page */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const URL_ATTRIBUTES = {
    a: ['href'], area: ['href'], link: ['href'], script: ['src'], img: ['src', 'srcset'], source: ['src', 'srcset'],
    iframe: ['src'], video: ['src', 'poster'], audio: ['src'],
};
const ARIA_REFERENCES = ['aria-labelledby', 'aria-controls', 'aria-describedby', 'aria-owns', 'aria-activedescendant'];

function decode(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] !== '#') { return NAMED[code.toLowerCase()] ?? whole; }
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    });
}

function parseAttributes(text) {
    const attributes = {};
    for (const match of text.matchAll(ATTRIBUTE)) {
        const name = match[1].toLowerCase();
        if (!(name in attributes)) { attributes[name] = decode(match[2] ?? match[3] ?? match[4] ?? ''); }
    }
    return attributes;
}

// Reads one page into what the checks need. Tags are followed with a stack so mismatched or unclosed ones are found.
function parse(html) {
    const page = {
        markup: [], doctype: false, lang: null, title: '', description: null, canonical: null, robots: '', mains: 0,
        ids: new Map(), duplicateIds: [], headings: [], images: [], iframes: [], references: [], labelFor: new Set(),
        controls: [], unnamed: [], links: [], metaUrls: [],
    };
    const lineAt = lineLookup(html);
    const stack = [];        // elements still waiting for their closing tag: { tag, line, collector }
    const collecting = [];   // links, buttons and headings whose text is being gathered
    let inTitle = false;
    let labels = 0;
    let svgs = 0;
    let position = 0;

    const problem = (message, line) => page.markup.push({ message, line });

    const close = (frame) => {
        if (frame.collector) {
            collecting.splice(collecting.indexOf(frame.collector), 1);
            const { kind, text, attributes, line } = frame.collector;
            const named = text.trim() || attributes['aria-label'] || attributes['aria-labelledby'] || attributes.title;
            if ((kind === 'button' || (kind === 'link' && 'href' in attributes)) && !named) { page.unnamed.push({ kind, line }); }
        }
        if (frame.tag === 'title') { inTitle = false; }
        if (frame.tag === 'label') { labels--; }
        if (frame.tag === 'svg') { svgs--; }
    };

    const start = (tag, attributes, line) => {
        if (attributes.id) {
            if (page.ids.has(attributes.id)) { page.duplicateIds.push({ id: attributes.id, line }); } else { page.ids.set(attributes.id, line); }
        }
        if (tag === 'a' && attributes.name && !page.ids.has(attributes.name)) { page.ids.set(attributes.name, line); }
        for (const key of ARIA_REFERENCES) {
            for (const id of (attributes[key] ?? '').split(/\s+/).filter(Boolean)) { page.references.push({ key, id, line }); }
        }
        for (const attribute of URL_ATTRIBUTES[tag] ?? []) {
            const value = (attributes[attribute] ?? '').trim();
            if (!value) { continue; }
            const urls = attribute === 'srcset' ? value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]) : [value];
            for (const url of urls) { page.links.push({ tag, attribute, url, line }); }
        }

        let collector = null;
        if (tag === 'html') { page.lang = attributes.lang ?? null; }
        else if (tag === 'title') { inTitle = true; }
        else if (tag === 'main') { page.mains++; }
        else if (tag === 'label') { labels++; if (attributes.for) { page.labelFor.add(attributes.for); } }
        else if (tag === 'meta') {
            const name = (attributes.name ?? '').toLowerCase();
            const key = (attributes.property ?? attributes.name ?? '').toLowerCase();
            if (name === 'description') { page.description = attributes.content ?? ''; }
            if (name === 'robots') { page.robots = (attributes.content ?? '').toLowerCase(); }
            if (['og:url', 'og:image', 'twitter:image'].includes(key) && attributes.content) { page.metaUrls.push({ label: key, url: attributes.content, line }); }
            if ((attributes['http-equiv'] ?? '').toLowerCase() === 'refresh') {
                const target = /url\s*=\s*['"]?([^'";]+)/i.exec(attributes.content ?? '');
                if (target) { page.metaUrls.push({ label: 'redirect', url: target[1].trim(), line }); }
            }
        } else if (tag === 'link' && (attributes.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
            page.canonical = attributes.href ?? '';
        } else if (tag === 'img') {
            page.images.push({ src: attributes.src ?? '', alt: attributes.alt ?? null, width: attributes.width, height: attributes.height, line });
            for (const open of collecting) { open.text += ` ${attributes.alt ?? ''}`; }
        } else if (tag === 'iframe') {
            page.iframes.push({ title: attributes.title ?? '', line });
        } else if (['input', 'select', 'textarea'].includes(tag)) {
            const type = (attributes.type ?? 'text').toLowerCase();
            if (!(tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type))) {
                page.controls.push({ id: attributes.id, line, labelled: labels > 0 || Boolean(attributes['aria-label'] || attributes['aria-labelledby']) });
            }
        } else if (/^h[1-6]$/.test(tag)) {
            collector = { kind: 'heading', level: Number(tag[1]), text: '', attributes, line };
            page.headings.push(collector);
        } else if (tag === 'a' || tag === 'button') {
            collector = { kind: tag === 'a' ? 'link' : 'button', text: '', attributes, line };
        } else if (tag === 'svg') { svgs++; }
        if (collector) { collecting.push(collector); }
        return collector;
    };

    while (position < html.length) {
        const lt = html.indexOf('<', position);
        const text = html.slice(position, lt === -1 ? html.length : lt);
        if (text) {
            if (inTitle) { page.title += text; }
            for (const open of collecting) { open.text += text; }
        }
        if (lt === -1) { break; }

        if (html.startsWith('<!--', lt)) {
            const end = html.indexOf('-->', lt + 4);
            if (end === -1) { problem('a comment starting with <!-- is never ended with -->', lineAt(lt)); break; }
            position = end + 3;
            continue;
        }
        if (html[lt + 1] === '!' || html[lt + 1] === '?') {
            if (/^<!doctype\s+html\s*>/i.test(html.slice(lt, lt + 40))) { page.doctype = true; }
            const end = html.indexOf('>', lt);
            position = end === -1 ? html.length : end + 1;
            continue;
        }

        TAG.lastIndex = lt;
        const match = TAG.exec(html);
        if (!match) {
            if (/[a-zA-Z/]/.test(html[lt + 1] ?? '')) { problem('a "<" that does not start a complete tag (is a ">" or a quote missing?)', lineAt(lt)); }
            position = lt + 1;
            continue;
        }
        position = TAG.lastIndex;
        const [, slash, name, rest] = match;
        const tag = name.toLowerCase();
        const line = lineAt(lt);

        if (slash) {
            if (VOID.has(tag)) { continue; }
            const index = stack.map((frame) => frame.tag).lastIndexOf(tag);
            if (index === -1) { problem(`</${tag}> has no matching <${tag}> before it`, line); continue; }
            while (stack.length - 1 > index) {
                const frame = stack.pop();
                problem(`<${frame.tag}> is never closed (</${tag}> on line ${line} arrives while it is still open)`, frame.line);
                close(frame);
            }
            close(stack.pop());
            continue;
        }

        const attributes = parseAttributes(rest);
        const collector = start(tag, attributes, line);
        if (!VOID.has(tag) && !(svgs > 0 && /\/\s*$/.test(rest))) { stack.push({ tag, line, collector }); }
        if (tag === 'script' || tag === 'style') {      // what is inside is code, not tags
            const closing = new RegExp(`</${tag}\\s*>`, 'ig');
            closing.lastIndex = position;
            const end = closing.exec(html);
            if (end === null) { problem(`<${tag}> is never closed`, line); break; }
            position = end.index;
        }
    }
    for (const frame of stack) { problem(`<${frame.tag}> is never closed`, frame.line); }
    return page;
}

const parsed = new Map();
function pageAt(file) {
    if (!parsed.has(file)) { parsed.set(file, parse(read(file))); }
    return parsed.get(file);
}

/* ------------------------------------------------------------------ following links */

const safeDecode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };
const referenced = new Set();

// Works out where a link leads: { external } for another website, { file, fragment } for something on this site,
// { problem } when it leads nowhere, or {} for links that are not files (mailto:, tel:, ...).
function follow(from, url) {
    if (/^(mailto|tel|sms|javascript|data|blob):/i.test(url)) { return {}; }
    let target = url.trim();
    if (OWN_SITE.test(target)) {
        // Other repositories of the same GitHub account are published under i-rop.github.io/<repository>/ (for example
        // the Image-Comparator tools). A folder that does not exist here is one of those, so it counts as another website.
        const inside = target.replace(OWN_SITE, '').split(/[?#]/)[0].split('/').filter(Boolean);
        if (inside.length > 1 && !locate(inside[0]).path && !locate(inside[0]).caseHint) { return { external: target }; }
        target = target.replace(OWN_SITE, '') || '/';
    } else if (/^(https?:)?\/\//i.test(target)) { return { external: target.startsWith('//') ? `https:${target}` : target }; }

    const hash = target.indexOf('#');
    const fragment = hash === -1 ? '' : safeDecode(target.slice(hash + 1));
    const path = safeDecode((hash === -1 ? target : target.slice(0, hash)).split('?')[0]);

    let relative = path === '' ? from : path.startsWith('/') ? posix.normalize(path).replace(/^\/+/, '') : posix.normalize(posix.join(posix.dirname(from), path));
    if (relative === '..' || relative.startsWith('../')) { return { problem: 'leads outside the site folder' }; }
    relative = relative.replace(/^\.\/?/, '');
    const wantsFolder = path.endsWith('/') || relative === '';
    relative = relative.replace(/\/+$/, '');

    const hit = locate(relative);
    let file = null;
    let hint = hit.caseHint;
    if (hit.path && statSync(hit.path).isDirectory()) {
        const index = locate(posix.join(relative, 'index.html'));
        if (!index.path) { return { problem: `the folder "${relative}/" has no index.html` }; }
        file = posix.join(relative, 'index.html');
    } else if (hit.path) {
        file = relative;
    } else if (!extname(relative) && !wantsFolder) {
        const page = locate(`${relative}.html`);       // GitHub Pages serves /people as people.html
        if (page.path) { file = `${relative}.html`; } else { hint = hint ?? page.caseHint; }
    }
    if (!file) {
        return { problem: hint ? `the capitalisation is wrong, the real name is "${hint}" (GitHub Pages is case-sensitive)` : 'there is no such file' };
    }
    referenced.add(file);
    if (fragment && fragment !== 'top' && file.endsWith('.html') && !pageAt(file).ids.has(fragment)) {
        return { problem: `there is no section with id="${fragment}" on ${file}` };
    }
    return { file, fragment };
}

const NOUN = { a: 'link', area: 'link', link: 'linked file', script: 'script', img: 'picture', source: 'picture', iframe: 'embedded page', video: 'video', audio: 'audio' };

/* ------------------------------------------------------------------ checks */

const files = walk();
const pagePaths = files.filter((file) => file.endsWith('.html')).sort();
const externalUrls = new Map();      // outside address -> [{ file, line }]
const noteExternal = (url, file, line) => {
    if (!externalUrls.has(url)) { externalUrls.set(url, []); }
    externalUrls.get(url).push({ file, line });
};
let linkCount = 0;

const expectedCanonical = (file) => `${SITE}${file === 'index.html' ? '' : file.replace(/index\.html$/, '')}`;

function checkPage(file) {
    const page = pageAt(file);
    const html = read(file);
    const isRedirect = html.includes('<!-- chrome:none -->');
    const isNoindex = /noindex/.test(page.robots);

    for (const { message, line } of page.markup) { error(file, `Markup: ${message}.`, line); }
    for (const { id, line } of page.duplicateIds) { error(file, `The id "${id}" is used more than once on this page (first on line ${page.ids.get(id)}).`, line); }
    if (!page.doctype) { warn(file, 'The page does not start with <!DOCTYPE html>.'); }
    if (!page.lang) { error(file, 'The <html> tag has no lang="en" (screen readers need it to pick a voice).'); }
    if (!page.title.trim()) { error(file, 'The page has no <title>.'); }

    // Links, pictures, scripts and stylesheets, whichever kind of page this is.
    const references = [...page.links.map((link) => ({ ...link, noun: NOUN[link.tag] ?? 'file' })),
        ...page.metaUrls.map((meta) => ({ url: meta.url, line: meta.line, noun: `<meta ${meta.label}> address` }))];
    for (const reference of references) {
        linkCount++;
        const result = follow(file, reference.url);
        if (result.external) {
            noteExternal(result.external, file, reference.line);
            if (result.external.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(result.external)) {
                warn(file, `The ${reference.noun} "${reference.url}" uses http://, which browsers mark "not secure". Try https:// instead.`, reference.line);
            }
        } else if (result.problem) {
            error(file, `The ${reference.noun} "${reference.url}" is broken: ${result.problem}.`, reference.line);
        }
    }
    if (isRedirect) { return; }

    // Search and sharing details.
    if (page.description === null) { error(file, 'There is no <meta name="description"> (search results show it).'); }
    else if (page.description.length > MAX_DESCRIPTION) { warn(file, `The description is ${page.description.length} characters; search results cut it off after about ${MAX_DESCRIPTION}.`); }
    if (page.canonical === null) {
        if (!isNoindex) { error(file, 'There is no <link rel="canonical"> (and the page is not marked noindex).'); }
    } else if (page.canonical !== expectedCanonical(file)) {
        error(file, `The canonical address is ${page.canonical} but this page lives at ${expectedCanonical(file)}.`);
    }
    for (const meta of page.metaUrls.filter((entry) => entry.label === 'og:url')) {
        if (meta.url !== expectedCanonical(file)) { warn(file, `og:url is ${meta.url} but this page lives at ${expectedCanonical(file)}.`, meta.line); }
    }

    // Page structure.
    if (page.mains !== 1) { error(file, `The page has ${page.mains} <main> elements; it needs exactly one.`); }
    if (!page.ids.has('main')) { error(file, 'No element has id="main", so the "Skip to content" link has nowhere to go.'); }
    if (!page.links.some((link) => link.url === '#main')) { warn(file, 'The "Skip to content" link (href="#main") is missing.'); }
    const h1s = page.headings.filter((heading) => heading.level === 1);
    if (h1s.length !== 1) { error(file, `The page has ${h1s.length} main headings (<h1>); it needs exactly one.`, h1s[1]?.line); }
    for (let i = 1; i < page.headings.length; i++) {
        const [before, after] = [page.headings[i - 1], page.headings[i]];
        if (after.level > before.level + 1) {
            error(file, `The heading level jumps from <h${before.level}> to <h${after.level}> ("${after.text.trim().slice(0, 40)}"). Do not skip levels.`, after.line);
        }
    }
    for (const heading of page.headings.filter((entry) => !entry.text.trim())) { error(file, `An empty <h${heading.level}> heading.`, heading.line); }
    for (const { key, id, line } of page.references) {
        if (!page.ids.has(id)) { error(file, `${key}="${id}" points at an element that does not exist.`, line); }
    }

    // Accessibility basics.
    for (const image of page.images) {
        if (image.alt === null) { error(file, `The picture "${image.src}" has no alt text (use alt="" if it is only decoration).`, image.line); }
        else if (/\.(jpe?g|png|gif|svg|webp)$/i.test(image.alt.trim())) { warn(file, `The alt text "${image.alt}" looks like a file name; describe the picture instead.`, image.line); }
        if (!(image.width && image.height)) { warn(file, `The picture "${image.src}" has no width and height, so the page jumps while it loads.`, image.line); }
    }
    for (const { kind, line } of page.unnamed) { error(file, `A ${kind} has no text or aria-label, so a screen reader cannot say what it does.`, line); }
    for (const control of page.controls) {
        if (!(control.labelled || (control.id && page.labelFor.has(control.id)))) { error(file, `The form field${control.id ? ` "${control.id}"` : ''} has no label.`, control.line); }
    }
    for (const frame of page.iframes.filter((entry) => !entry.title.trim())) { error(file, 'An <iframe> has no title attribute.', frame.line); }
}

// The publications page: one PubMed entry per paper, in year groups with a jump link for each year.
function checkPublications(file) {
    const html = read(file).replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
    const lineAt = lineLookup(html);
    const seen = new Map();
    let count = 0;
    for (const entry of html.matchAll(/<li class="pub">([\s\S]*?)<\/li>/g)) {
        count++;
        const line = lineAt(entry.index);
        if (!/class="pub-title"/.test(entry[1])) { error(file, 'A publication entry has no title (class="pub-title").', line); }
        const linked = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\//.exec(entry[1])?.[1];
        const written = /PMID:\s*(\d+)/.exec(entry[1])?.[1];
        if (linked && written && linked !== written) { error(file, `The PubMed link says ${linked} but the entry says "PMID: ${written}".`, line); }
        const id = linked ?? written;
        if (!id) { continue; }
        if (seen.has(id)) { error(file, `PubMed ID ${id} is listed twice (first on line ${seen.get(id)}).`, line); } else { seen.set(id, line); }
    }
    const years = pageAt(file).headings.filter((heading) => /\bpubs-year\b/.test(heading.attributes.class ?? ''));
    const chips = new Set([...(/<ul class="chips"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '').matchAll(/href="#(y\d{4})"/g)].map((chip) => chip[1]));
    years.forEach((heading, index) => {
        const year = heading.text.trim();
        if (heading.attributes.id !== `y${year}`) { error(file, `The year heading "${year}" should have id="y${year}".`, heading.line); }
        if (index > 0 && Number(year) >= Number(years[index - 1].text.trim())) { warn(file, `Year ${year} is not listed after ${years[index - 1].text.trim()}; keep the newest year first.`, heading.line); }
        if (!chips.has(`y${year}`)) { warn(file, `There is no jump link for ${year} in the list of years at the top.`, heading.line); }
    });
    return count;
}

// Stylesheets can point at pictures too.
function checkStylesheet(file) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
    const lineAt = lineLookup(css);
    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        linkCount++;
        if (/^(data:|#)/i.test(match[2].trim())) { continue; }
        const result = follow(file, match[2].trim());
        if (result.external) { noteExternal(result.external, file, lineAt(match.index)); }
        else if (result.problem) { error(file, `The address "${match[2].trim()}" is broken: ${result.problem}.`, lineAt(match.index)); }
    }
}

function checkImages() {
    for (const file of files.filter((entry) => entry.startsWith('images/'))) {
        const kilobytes = Math.round(statSync(join(ROOT, file)).size / 1024);
        if (!WEB_IMAGES.has(extname(file).toLowerCase())) { warn(file, `Browsers cannot show ${extname(file) || 'this'} files; save it as a JPEG or PNG.`); }
        if (kilobytes > MAX_IMAGE_BYTES / 1024) { warn(file, `It is ${kilobytes} KB. Pictures over ${MAX_IMAGE_BYTES / 1024} KB slow the page; resize it to at most 1600 pixels wide and save it as a JPEG.`); }
        if (!referenced.has(file)) { warn(file, 'No page or stylesheet uses this picture (delete it, or add it to a page).'); }
    }
}

// GitHub Pages publishes the spelling git has. On a Mac the disk may spell a file differently without git noticing.
function checkGitSpelling() {
    const result = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) { return; }
    for (const tracked of result.stdout.split('\0').filter(Boolean)) {
        const found = locate(tracked);
        if (found.caseHint) {
            error(tracked, `git lists this file as "${tracked}" but on your disk it is "${found.caseHint}". GitHub Pages publishes git's spelling, so links to the disk's spelling would break. Fix: git mv "${tracked}" "${tracked}.tmp" && git mv "${tracked}.tmp" "${found.caseHint}"`);
        }
    }
}

function checkShared() {
    const result = spawnSync(process.execPath, [join(ROOT, '_tools', 'sync-chrome.mjs'), '--check'], { encoding: 'utf8' });
    if (result.status !== 0) {
        const output = (result.stdout + result.stderr).trim().split('\n').filter(Boolean);
        error('_tools/sync-chrome.mjs', `The shared header, menu, footer or sitemap is out of date. ${output.join(' ')}`);
    }
}

function checkDuplicates(label, valueOf) {
    const groups = new Map();
    for (const file of pagePaths) {
        const page = pageAt(file);
        const value = (valueOf(page) ?? '').trim();
        if (!value || read(file).includes('<!-- chrome:none -->') || /noindex/.test(page.robots)) { continue; }
        groups.set(value, [...(groups.get(value) ?? []), file]);
    }
    for (const [value, sharing] of groups) {
        if (sharing.length > 1) { for (const file of sharing) { warn(file, `The ${label} "${value.slice(0, 60)}" is also used by ${sharing.filter((other) => other !== file).join(', ')}.`); } }
    }
}

/* ------------------------------------------------------------------ outside addresses */

const USER_AGENT = 'Mozilla/5.0 (compatible; i-rop-site-link-check)';
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function probe(url) {
    let outcome = { status: 0, reason: '', movedToHome: false };
    for (const method of ['HEAD', 'GET']) {      // some servers refuse HEAD, so a refusal is retried as GET
        try {
            const response = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': USER_AGENT, accept: '*/*' } });
            await response.body?.cancel();
            // A deep link that ends up on a website's front page has usually moved, even though the server says "OK".
            const movedToHome = new URL(response.url).pathname === '/' && new URL(url).pathname !== '/';
            outcome = { status: response.status, reason: '', movedToHome };
            if (method === 'HEAD' && [400, 403, 404, 405, 406, 501].includes(response.status)) { continue; }
            break;
        } catch (failure) {
            const code = failure.cause?.code ?? '';
            outcome = { status: 0, reason: failure.name === 'TimeoutError' ? 'it did not answer within 15 seconds' : code || failure.message, movedToHome: false };
            if (code === 'ENOTFOUND') { break; }
        }
    }
    return outcome;
}

async function checkExternal() {
    const byHost = new Map();
    for (const url of externalUrls.keys()) {
        const host = new URL(url).host;
        byHost.set(host, [...(byHost.get(host) ?? []), url]);
    }
    let done = 0;
    await Promise.all([...byHost].map(async ([host, urls]) => {
        for (const url of urls) {           // one request at a time per website, so no website is hammered
            const { status, reason, movedToHome } = await probe(url);
            done++;
            if (process.stdout.isTTY) { process.stdout.write(`\r  ${done} of ${externalUrls.size} outside addresses checked`); }
            const places = externalUrls.get(url);
            if (status >= 200 && status < 400) {
                if (movedToHome) {
                    for (const { file, line } of places) { warn(file, `The outside address ${url} now sends visitors to the website's front page, so the page has probably moved.`, line); }
                }
            } else if (status === 404 || status === 410 || reason === 'ENOTFOUND') {
                for (const { file, line } of places) { error(file, `The outside address ${url} is dead (${status ? `error ${status}` : 'the website name does not exist'}).`, line); }
            } else {
                for (const { file, line } of places) { warn(file, `The outside address ${url} could not be checked (${status ? `error ${status}` : reason}). Open it in a browser to be sure.`, line); }
            }
            await pause(host.endsWith('ncbi.nlm.nih.gov') ? 400 : 150);
        }
    }));
    if (process.stdout.isTTY) { process.stdout.write('\r\x1b[K'); }
}

/* ------------------------------------------------------------------ run */

for (const file of pagePaths) { checkPage(file); }
const publications = pagePaths.includes('publications.html') ? checkPublications('publications.html') : 0;
for (const file of files.filter((entry) => entry.endsWith('.css'))) { checkStylesheet(file); }
checkDuplicates('title', (page) => page.title);
checkDuplicates('description', (page) => page.description);
checkImages();
checkGitSpelling();
checkShared();
if (CHECK_EXTERNAL) {
    console.log(`Visiting ${externalUrls.size} outside web addresses (about a minute)...`);
    await checkExternal();
}

const byFile = new Map();
for (const finding of findings) { byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]); }
for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${color.bold}${file}${color.reset}`);
    for (const { severity, message, line } of list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
        const mark = severity === 'error' ? `${color.red}error  ${color.reset}` : `${color.yellow}warning${color.reset}`;
        console.log(`  ${mark} ${line ? `line ${line}: ` : ''}${message}`);
    }
    console.log();
}

const errors = findings.filter((finding) => finding.severity === 'error').length;
const warnings = findings.length - errors;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
console.log(`${color.dim}Checked ${plural(pagePaths.length, 'page')}, ${plural(publications, 'publication')}, ${plural(linkCount, 'link')} and ${plural(files.filter((file) => file.startsWith('images/')).length, 'picture')}.${CHECK_EXTERNAL ? '' : ' Outside web addresses were not visited; add --external to test them too.'}${color.reset}`);
if (errors) {
    console.log(`${color.red}${color.bold}${plural(errors, 'error')}${color.reset}${warnings ? ` and ${plural(warnings, 'warning')}` : ''}. Fix the errors before publishing.`);
} else {
    console.log(`${color.green}${color.bold}No errors.${color.reset}${warnings ? ` ${plural(warnings, 'warning')} (advice only).` : ' Nothing to fix.'}`);
}
process.exit(errors ? 1 : 0);
