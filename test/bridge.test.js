'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BRIDGE = path.join(__dirname, '..', 'index.js');
const KEY = 'apz_' + 'ab12cd34'.repeat(5);

function startServer(handler) {
    return new Promise(function (resolve) {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', function () { resolve(server); });
    });
}

function readBody(req) {
    return new Promise(function (resolve) {
        const chunks = [];
        req.on('data', function (c) { chunks.push(c); });
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    });
}

function run(port, lines, expected, key) {
    return new Promise(function (resolve, reject) {
        const env = Object.assign({}, process.env, {
            APPYZEEN_API_KEY: key === undefined ? KEY : key,
            APPYZEEN_MCP_URL: 'http://127.0.0.1:' + port + '/mcp'
        });
        const child = spawn(process.execPath, [BRIDGE], { env: env, stdio: ['pipe', 'pipe', 'pipe'] });
        const out = [];
        let stderr = '';
        let buffer = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', function (c) { stderr += c; });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', function (chunk) {
            buffer += chunk;
            let cut;
            while ((cut = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, cut).trim();
                buffer = buffer.slice(cut + 1);
                if (line !== '') out.push(JSON.parse(line));
            }
            if (out.length >= expected) child.stdin.end();
        });
        child.on('error', reject);
        child.on('close', function (code) { resolve({ out: out, stderr: stderr, code: code }); });
        for (const line of lines) child.stdin.write(JSON.stringify(line) + '\n');
        if (expected === 0) child.stdin.end();
    });
}

test('it attaches the key and passes the reply straight through', async function () {
    let seen = null;
    const server = await startServer(async function (req, res) {
        seen = { auth: req.headers.authorization, body: JSON.parse(await readBody(req)) };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'appyzeen' } } }));
    });
    const { out } = await run(server.address().port, [{ jsonrpc: '2.0', id: 1, method: 'initialize' }], 1);
    server.close();

    assert.equal(seen.auth, 'Bearer ' + KEY);
    assert.equal(seen.body.method, 'initialize');
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'appyzeen' } } });
});

test('a notification is forwarded but never answered', async function () {
    const methods = [];
    const server = await startServer(async function (req, res) {
        const message = JSON.parse(await readBody(req));
        methods.push(message.method);
        if (message.id === undefined) return res.writeHead(202).end();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
    });
    const { out } = await run(server.address().port, [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'ping' }
    ], 1);
    server.close();

    assert.deepEqual(methods, ['notifications/initialized', 'ping']);
    assert.equal(out.length, 1, 'only the request with an id gets a reply');
    assert.equal(out[0].id, 2);
});

test('an HTML error page from a proxy becomes a JSON-RPC error, not a crash', async function () {
    const server = await startServer(function (req, res) {
        res.writeHead(502, { 'content-type': 'text/html' });
        res.end('<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>');
    });
    const { out } = await run(server.address().port, [{ jsonrpc: '2.0', id: 7, method: 'tools/list' }], 1);
    server.close();

    assert.equal(out.length, 1);
    assert.equal(out[0].id, 7);
    assert.equal(out[0].error.code, -32603);
    assert.match(out[0].error.message, /HTTP 502/);
});

test('a missing key exits with something a human can act on', async function () {
    const server = await startServer(function (req, res) { res.writeHead(200).end('{}'); });
    const { code, stderr, out } = await run(server.address().port, [], 0, '');
    server.close();

    assert.equal(code, 1);
    assert.equal(out.length, 0);
    assert.match(stderr, /APPYZEEN_API_KEY/);
    assert.match(stderr, /appyzeen\.com\/settings/);
});
