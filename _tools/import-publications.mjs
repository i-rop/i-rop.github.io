#!/usr/bin/env node
/*
 * Adds new i-ROP publications from PubMed to publications.html. Existing entries are never changed or moved.
 *
 *   node _tools/import-publications.mjs                 add every new paper found (published 2021 or later)
 *   node _tools/import-publications.mjs --dry-run       show what would be added, change nothing
 *   node _tools/import-publications.mjs --from 2015     look further back than 2021
 *   node _tools/import-publications.mjs --add 12345678  add one paper by PMID, whatever the rules say
 *   node _tools/import-publications.mjs --verbose       also list the papers that were found but left out
 *
 * Papers you do not want can be listed (one PMID per line) in _tools/publications-ignore.txt; they are skipped.
 * Needs Node 18 or newer and an internet connection. Uses NCBI's public E-utilities (no key needed).
 *
 * What counts as "i-ROP work": PubMed is searched for papers about retinopathy of prematurity (ROP) written by the
 * core investigators below, or that name the consortium. Then a paper is kept if
 *   1. it names the i-ROP / Imaging and Informatics in ROP consortium, or
 *   2. ROP is in its title or is a major MeSH topic, and at least one core investigator is an author, or
 *   3. it mentions ROP anywhere and at least two core investigators are authors.
 * Rule 3 keeps work such as OCT and AI papers where ROP is a use case, while a general review that has one core
 * author and a passing mention of ROP is left out. On the 55 papers curated by hand before this tool existed the rule
 * kept all 55. To change who counts, edit CORE below.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = join(ROOT, 'publications.html');
const IGNORE_FILE = join(ROOT, '_tools', 'publications-ignore.txt');

const DEFAULT_FROM_YEAR = 2021;
const MAX_AUTHORS = 30;        // longer author lists are cut to the first 20 followed by "et al."

// Core investigators: how they appear as PubMed authors, and the PubMed searches that find them.
const CORE = [
    { name: 'Chiang MF', test: /^Chiang MF/, search: ['"Chiang MF"[Author]'] },
    { name: 'Campbell JP', test: /^Campbell JP/, search: ['"Campbell JP"[Author]'] },
    { name: 'Kalpathy-Cramer J', test: /^Kalpathy-Cramer J/, search: ['"Kalpathy-Cramer J"[Author]'] },
    { name: 'Ostmo S', test: /^Ostmo S/, search: ['"Ostmo S"[Author]'] },
    { name: 'Chan RV', test: /^(Paul )?Chan RV/, search: ['"Chan RVP"[Author]', '"Chan RV"[Author]', '"Paul Chan RV"[Author]'] },
];
const CONSORTIUM_SEARCH = ['"Imaging and Informatics in Retinopathy of Prematurity"', '"i-ROP Research Consortium"'];
const CONSORTIUM_TEST = /Imaging\s*(?:and|&)\s*Informatics in (?:Retinopathy of Prematurity|ROP)|i-ROP (?:Research )?Consortium/i;
const TOPIC_SEARCH = '("retinopathy of prematurity"[MeSH Terms] OR "retinopathy of prematurity"[Title/Abstract] OR "ROP"[Title/Abstract])';

/* ------------------------------------------------------------------ command line */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dryRun = flag('--dry-run');
const verbose = flag('--verbose');
const fromYear = Number(option('--from') || DEFAULT_FROM_YEAR);
const forced = (option('--add') || '').split(/[,\s]+/).filter(Boolean);

if (Number.isNaN(fromYear) || fromYear < 1990) { fail('--from needs a year, for example --from 2019'); }
for (const id of forced) { if (!/^\d+$/.test(id)) { fail(`--add needs PubMed ids (numbers), got "${id}"`); } }

function fail(message) {
    console.error(`\nError: ${message}`);
    process.exit(1);
}

/* ------------------------------------------------------------------ PubMed access */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// NCBI allows 3 requests a second without an API key; stay well under that and retry briefly on hiccups.
async function eutils(endpoint, params) {
    const body = new URLSearchParams({ tool: 'irop-site', ...params });
    for (let attempt = 1; attempt <= 4; attempt++) {
        await sleep(400);
        try {
            const response = await fetch(EUTILS + endpoint, { method: 'POST', body });
            if (response.ok) { return await response.text(); }
            if (response.status !== 429 && response.status < 500) { fail(`PubMed answered ${response.status} for ${endpoint}`); }
        } catch (error) {
            if (attempt === 4) { fail(`could not reach PubMed (${error.cause?.code || error.message}). Check your internet connection and try again.`); }
        }
        await sleep(1500 * attempt);
    }
    return fail(`PubMed did not answer ${endpoint}; try again in a minute`);
}

async function searchIds(term) {
    const json = JSON.parse(await eutils('esearch.fcgi', { db: 'pubmed', term, retmode: 'json', retmax: '10000' }));
    return json.esearchresult.idlist;
}

async function fetchRecords(ids) {
    const records = [];
    for (let i = 0; i < ids.length; i += 100) {
        const text = await eutils('efetch.fcgi', { db: 'pubmed', id: ids.slice(i, i + 100).join(','), rettype: 'medline', retmode: 'text' });
        records.push(...parseMedline(text));
    }
    return records;
}

// MEDLINE text: "TAG - value" lines, continued on lines that start with six spaces; records are separated by a blank line.
function parseMedline(text) {
    const records = [];
    for (const block of text.trim().split(/\n\s*\n/)) {
        const record = {};
        let tag = null;
        for (const line of block.split('\n')) {
            const match = line.match(/^([A-Z][A-Z0-9]{1,3})\s*- (.*)$/);
            if (match) {
                tag = match[1];
                (record[tag] ||= []).push(match[2].trim());
            } else if (tag && line.startsWith('      ')) {
                const values = record[tag];
                values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`;
            }
        }
        if (record.PMID) { records.push(record); }
    }
    return records;
}

/* ------------------------------------------------------------------ the inclusion rule */

const coreAuthors = (record) => CORE.filter((core) => (record.AU || []).some((name) => core.test.test(name)));
const namesConsortium = (record) =>
    CONSORTIUM_TEST.test([record.TI, record.AB, record.CN, record.AU, record.FAU, record.IR, record.FIR].flat().filter(Boolean).join(' '));
const ropInTitleOrMajorMesh = (record) =>
    /retinopathy of prematurity|\bROP\b/i.test((record.TI || []).join(' ')) ||
    (record.MH || []).some((heading) => /^\*?Retinopathy of Prematurity/.test(heading) && heading.includes('*'));

// Returns the reason a paper is kept, or null if it is left out.
function why(record) {
    const core = coreAuthors(record).length;
    if (namesConsortium(record)) { return 'names the consortium'; }
    if (core >= 1 && ropInTitleOrMajorMesh(record)) { return 'ROP paper by a core investigator'; }
    if (core >= 2) { return `${core} core investigators`; }
    return null;
}

/* ------------------------------------------------------------------ turning a PubMed record into a page entry */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2021 Mar 2" or "... 2021 Mar;11(1):4966 ..." -> 20210302. Missing month or day count as 0.
function dateKey(text) {
    const year = text.match(/\b(?:19|20)\d{2}\b/);
    if (!year) { return 0; }
    const rest = text.slice(year.index + 4);
    const month = rest.match(/^\s*([A-Za-z]{3})/);
    const monthNumber = month ? MONTHS.indexOf(month[1].toLowerCase()) + 1 : 0;
    const day = monthNumber ? rest.match(/^\s*[A-Za-z]{3}[A-Za-z-]*\s+(\d{1,2})\b/) : null;
    return Number(year[0]) * 10000 + monthNumber * 100 + (day ? Number(day[1]) : 0);
}

const sentence = (text) => (/[.?!]$/.test(text) ? text : `${text}.`);

// A few journals print every title in capitals; those become sentence case (acronyms keep their capitals).
const ACRONYMS = ['AP-ROP', 'ICROP3', 'ICROP', 'ETROP', 'ROP', 'VEGF', 'OCTA', 'OCT', 'AI', 'NICU', 'ICU', 'MRI', 'DNA', 'RNA', 'COVID-19', 'US'];
function tidyTitle(title) {
    if (/[a-z]/.test(title)) { return title; }
    const lower = title.toLowerCase();
    return ACRONYMS.reduce((out, acronym) => out.replace(new RegExp(`\\b${acronym}\\b`, 'gi'), acronym), lower.charAt(0).toUpperCase() + lower.slice(1));
}
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function authorLine(record) {
    const people = record.AU || [];
    const collective = [...new Set(record.CN || [])];
    const names = people.length > MAX_AUTHORS ? `${people.slice(0, 20).join(', ')}, et al` : people.join(', ');
    return sentence(collective.length ? `${names}${names ? '; ' : ''}${collective.join('; ')}` : names);
}

// Same shape PubMed uses and the existing entries follow: "J Abbrev. 2021 Mar 2;11(1):4966. doi: 10.x/y. Epub 2021 Feb 1."
function citationLine(record) {
    const first = (tag) => (record[tag] || [])[0];
    const doi = (record.LID || []).concat(record.AID || []).map((id) => id.match(/^(.+) \[doi\]$/)).find(Boolean)?.[1];
    const published = first('DP') || '';
    let line = `${first('TA') || first('JT') || ''}. ${published}`;
    if (first('VI')) { line += `;${first('VI')}${first('IP') ? `(${first('IP')})` : ''}`; }
    if (first('PG')) { line += `:${first('PG')}`; }
    line += '.';
    if (doi) { line += ` doi: ${doi}.`; }
    const epub = first('DEP')?.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (epub) {
        const epubText = `${epub[1]} ${MONTH_NAMES[Number(epub[2]) - 1]} ${Number(epub[3])}`;
        if (!published.startsWith(epubText)) { line += ` Epub ${epubText}.`; }
    }
    if ((record.PST || []).includes('aheadofprint')) { line += ' Online ahead of print.'; }
    return line;
}

function toEntry(record) {
    const pmid = record.PMID[0];
    const title = sentence(tidyTitle((record.TI || []).join(' ')));
    const authors = authorLine(record);
    const citation = citationLine(record);
    const html = [
        '<li class="pub">',
        `<p class="pub-title">${escapeHtml(title)}</p>`,
        `<p class="pub-authors">${escapeHtml(authors)}</p>`,
        `<p class="pub-cite">${escapeHtml(citation)}</p>`,
        `<p class="pub-links"><a href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed Entry</a><span>PMID: ${pmid}</span></p>`,
        '</li>',
    ].join('\n');
    return { pmid, title, citation, key: dateKey((record.DP || [''])[0]), year: Math.floor(dateKey((record.DP || [''])[0]) / 10000), html };
}

/* ------------------------------------------------------------------ reading and rewriting the page */

const GROUP = /<h2 class="pubs-year" id="y(\d{4})">\d{4}<\/h2>\s*<ul class="pubs">([\s\S]*?)<\/ul>/g;

function readPage(html) {
    const groups = new Map();            // year -> [raw <li> html, ...] in page order
    let first = -1;
    let last = -1;
    let leftover = html;
    for (const match of html.matchAll(GROUP)) {
        if (first < 0) { first = match.index; }
        last = match.index + match[0].length;
        groups.set(Number(match[1]), match[2].match(/<li class="pub">[\s\S]*?<\/li>/g) || []);
        leftover = leftover.replace(match[0], '');
    }
    if (first < 0) { fail('could not find any <h2 class="pubs-year"> + <ul class="pubs"> groups in publications.html'); }
    // everything between the groups must be whitespace, otherwise the page was edited in a way this tool does not understand
    if (html.slice(first, last).replace(GROUP, '').trim() !== '') {
        fail('publications.html has extra content between the year groups; move it out or add the papers by hand');
    }
    const pmids = new Set([...groups.values()].flat().map((entry) => entry.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\//)?.[1]).filter(Boolean));
    return { groups, first, last, pmids };
}

function mergeInto(groups, entries) {
    for (const entry of entries) {
        const list = groups.get(entry.year) || [];
        const at = list.findIndex((existing) => dateKey(existing.match(/<p class="pub-cite">([\s\S]*?)<\/p>/)?.[1] || '') < entry.key);
        list.splice(at < 0 ? list.length : at, 0, entry.html);
        groups.set(entry.year, list);
    }
}

function writePage(html, page) {
    const years = [...page.groups.keys()].sort((a, b) => b - a);
    const blocks = years.map((year) => `<h2 class="pubs-year" id="y${year}">${year}</h2>\n<ul class="pubs">\n${page.groups.get(year).join('\n')}\n</ul>`);
    let out = html.slice(0, page.first) + blocks.join('\n') + html.slice(page.last);
    const chips = years.map((year) => `<li><a href="#y${year}">${year}</a></li>`).join('\n');
    const chipList = /(<ul class="chips" aria-label="Jump to a year">)[\s\S]*?(<\/ul>)/;
    if (!chipList.test(out)) { fail('could not find the year chips (<ul class="chips" aria-label="Jump to a year">) in publications.html'); }
    out = out.replace(chipList, (_, open, close) => `${open}\n${chips}\n${close}`);
    return out;
}

/* ------------------------------------------------------------------ run */

const html = readFileSync(PAGE, 'utf8');
const page = readPage(html);
const ignored = new Set(existsSync(IGNORE_FILE)
    ? readFileSync(IGNORE_FILE, 'utf8').split('\n').map((line) => line.replace(/#.*/, '').trim()).filter((line) => /^\d+$/.test(line))
    : []);
console.log(`publications.html has ${page.pmids.size} papers. Searching PubMed for i-ROP work published ${fromYear} or later...`);

const authorSearch = CORE.flatMap((core) => core.search).join(' OR ');
const term = `(((${TOPIC_SEARCH} AND (${authorSearch})) OR ${CONSORTIUM_SEARCH.join(' OR ')}) AND ${fromYear}:3000[dp])` +
    ' NOT ("Published Erratum"[pt] OR Preprint[pt] OR "Retracted Publication"[pt])';
const found = await searchIds(term);
const wanted = [...new Set([...found, ...forced])].filter((id) => !page.pmids.has(id));
console.log(`PubMed returned ${found.length} papers${forced.length ? ` (plus ${forced.length} you asked for by PMID)` : ''}; ${wanted.length} are not on the page yet.`);

const records = await fetchRecords(wanted);
const entries = [];
const skipped = [];
for (const record of records.sort((a, b) => dateKey((b.DP || [''])[0]) - dateKey((a.DP || [''])[0]))) {
    const pmid = record.PMID[0];
    const reason = forced.includes(pmid) ? 'added by PMID' : why(record);
    if (ignored.has(pmid)) { skipped.push({ record, reason: 'on the ignore list' }); continue; }
    if (!reason) { skipped.push({ record, reason: 'does not meet the rule' }); continue; }
    if (!(record.TI || []).length) { skipped.push({ record, reason: 'no title in PubMed' }); continue; }
    entries.push({ ...toEntry(record), reason });
}

const shortTitle = (record) => (record.TI || ['(no title)']).join(' ').slice(0, 90);
console.log(`\nAdding ${entries.length}:`);
for (const entry of entries) { console.log(`  ${entry.year}  ${entry.pmid}  ${entry.title.slice(0, 80).padEnd(80)}  (${entry.reason})`); }
console.log(`\nLeft out ${skipped.length}${verbose ? ':' : ' (run with --verbose to see them)'}`);
if (verbose) {
    for (const { record, reason } of skipped) { console.log(`  ${(record.DP || [''])[0].slice(0, 4)}  ${record.PMID[0]}  ${shortTitle(record)}  (${reason})`); }
}

if (!entries.length) {
    console.log('\nNothing to add; publications.html is up to date.');
} else if (dryRun) {
    console.log('\nDry run: nothing was written.');
} else {
    mergeInto(page.groups, entries);
    const updated = writePage(html, page);
    // read the result back before saving it: every old and new paper must be there exactly once
    const check = readPage(updated);
    const expected = page.pmids.size + entries.length;
    if (check.pmids.size !== expected) { fail(`internal check failed (${check.pmids.size} papers after the merge, expected ${expected}); nothing was written`); }
    writeFileSync(PAGE, updated);
    console.log(`\nWrote publications.html (${expected} papers). Next: node _tools/sync-chrome.mjs --check, then look at the page.`);
}
