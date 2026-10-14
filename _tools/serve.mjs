#!/usr/bin/env node
/*
 * Preview the site on your computer, served the way GitHub Pages serves it.
 *
 *   node _tools/serve.mjs              then open http://localhost:8000
 *   node _tools/serve.mjs --port 9000
 *
 * Unlike simply opening the files (or a plain "python3 -m http.server"), this behaves like the real site:
 *   - file names are case-sensitive, so "Images/Logo.JPG" is a 404 here when the file is "images/logo.jpg"
 *     (a Mac would quietly accept it, GitHub Pages would not);
 *   - /people opens people.html, and /risk-calculator redirects to /risk-calculator/ and opens its index.html;
 *   - an unknown address shows your 404.html with a real 404 status;
 *   - folders and files starting with "." or "_" (such as _tools) are not served, as on GitHub Pages;
 *   - nothing is cached, so a refresh always shows your latest edit.
 * Every request is printed; anything that is not a 200 stands out. Needs Node 18 or newer. Stop it with Ctrl+C.
 */
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const portIndex = process.argv.indexOf('--port');
const PORT = portIndex > -1 ? Number(process.argv[portIndex + 1]) : 8000;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error('Error: --port needs a number between 1 and 65535, for example --port 9000');
    process.exit(1);
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
    '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

const color = process.stdout.isTTY ? { red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' } : { red: '', yellow: '', dim: '', reset: '' };

// Finds the file for a list of path segments, matching capitalisation exactly.
// Returns { path } when found, { caseHint } (the correctly capitalised path) when only the capitalisation is wrong,
// or {} when there is no such file at all.
function locate(segments) {
    let current = ROOT;
    const actual = [];
    for (const segment of segments) {
        if (!statSync(current).isDirectory()) { return {}; }
        const names = readdirSync(current);
        const name = names.includes(segment) ? segment : names.find((candidate) => candidate.toLowerCase() === segment.toLowerCase());
        if (!name) { return {}; }
        actual.push(name);
        current = join(current, name);
    }
    return actual.every((name, index) => name === segments[index]) ? { path: current } : { caseHint: actual.join('/') };
}

// Pages publishes neither dot-folders nor underscore-folders (Jekyll's rule), so neither do we.
const hidden = (segments) => segments.some((segment) => segment.startsWith('.') || segment.startsWith('_'));

function resolve(urlPath) {
    const segments = urlPath.split('/').filter(Boolean);
    if (hidden(segments) || segments.includes('..')) { return { status: 404 }; }

    const exact = locate(segments);
    if (exact.path && statSync(exact.path).isDirectory()) {
        if (!urlPath.endsWith('/')) { return { status: 301 }; }
        const index = locate([...segments, 'index.html']);
        return index.path ? { status: 200, file: index.path } : { status: 404, caseHint: index.caseHint };
    }
    if (exact.path) { return { status: 200, file: exact.path }; }

    // /people -> people.html (but not /people/)
    let caseHint = exact.caseHint;
    if (!urlPath.endsWith('/') && segments.length && !extname(segments[segments.length - 1])) {
        const page = locate([...segments.slice(0, -1), `${segments[segments.length - 1]}.html`]);
        if (page.path) { return { status: 200, file: page.path }; }
        caseHint = caseHint || page.caseHint;
    }
    return { status: 404, caseHint };
}

const server = createServer((request, response) => {
    const started = Date.now();
    let status = 200;
    let note = '';
    try {
        const url = new URL(request.url, 'http://localhost');
        const urlPath = decodeURIComponent(url.pathname);
        const result = resolve(urlPath);
        status = result.status;

        if (status === 301) {
            response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
            response.end();
        } else if (status === 200) {
            const body = readFileSync(result.file);
            response.writeHead(200, { 'Content-Type': TYPES[extname(result.file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : body);
        } else {
            const page = join(ROOT, '404.html');
            response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(existsSync(page) ? readFileSync(page) : 'Not found');
            if (result.caseHint) { note = ` GitHub Pages is case-sensitive: the real name is "${result.caseHint}"`; }
        }
    } catch (error) {
        status = error instanceof URIError ? 400 : 500;
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(status === 400 ? 'Bad request' : 'Server error');
        note = ` ${error.message}`;
    }
    const tone = status >= 400 ? color.red : status >= 300 ? color.yellow : color.dim;
    console.log(`${tone}${status}${color.reset} ${request.method} ${request.url}  ${color.dim}${Date.now() - started} ms${color.reset}${note ? `${color.red}${note}${color.reset}` : ''}`);
});

server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
        ? `Error: port ${PORT} is already in use. Stop the other server or try: node _tools/serve.mjs --port ${PORT + 1}`
        : `Error: ${error.message}`);
    process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Serving the site from "${basename(ROOT)}" at  http://localhost:${PORT}`);
    console.log('Like GitHub Pages: case-sensitive file names, 404.html for unknown pages. Stop with Ctrl+C.\n');
});
