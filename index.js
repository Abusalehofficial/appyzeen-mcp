#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');

const VERSION = require('./package.json').version;
const ENDPOINT = process.env.APPYZEEN_MCP_URL || 'https://appyzeen.com/mcp';
const KEY = (process.env.APPYZEEN_API_KEY || '').trim();
const KEY_RE = /^apz_[0-9a-f]{40}$/;
const TIMEOUT_MS = Number(process.env.APPYZEEN_MCP_TIMEOUT_MS || 120000);

if (!KEY_RE.test(KEY)) {
    process.stderr.write(
        'appyzeen-mcp: APPYZEEN_API_KEY is missing or malformed.\n'
        + 'Get a key at https://appyzeen.com/settings (API keys tab). It looks like apz_ and 40 hex characters.\n'
    );
    process.exit(1);
}

let target;
try {
    target = new URL(ENDPOINT);
} catch (error) {
    process.stderr.write('appyzeen-mcp: APPYZEEN_MCP_URL is not a URL: ' + ENDPOINT + '\n');
    process.exit(1);
}
const transport = target.protocol === 'http:' ? http : https;

function write(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
}

function rpcError(id, code, message) {
    return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: code, message: message } };
}

function forward(message) {
    const id = message.id;
    const body = Buffer.from(JSON.stringify(message), 'utf8');

    let answered = id === undefined;
    const answer = function (reply) {
        if (answered) return;
        answered = true;
        write(reply);
    };

    const request = transport.request({
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'content-length': body.length,
            'authorization': 'Bearer ' + KEY,
            'user-agent': 'appyzeen-mcp/' + VERSION
        }
    }, function (response) {
        const chunks = [];
        response.on('data', function (chunk) { chunks.push(chunk); });
        response.on('end', function () {
            if (answered) return;
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (raw === '') {
                answer(rpcError(id, -32603, target.host + ' answered HTTP ' + response.statusCode + ' with an empty body.'));
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (error) {
                answer(rpcError(id, -32603, target.host + ' answered HTTP ' + response.statusCode
                    + ', which is not JSON-RPC: ' + raw.slice(0, 200)));
                return;
            }
            answer(parsed);
        });
    });

    request.setTimeout(TIMEOUT_MS, function () {
        request.destroy(new Error('no answer in ' + TIMEOUT_MS + ' ms'));
    });
    request.on('error', function (error) {
        answer(rpcError(id, -32603, 'Could not reach ' + target.host + ': ' + error.message));
    });
    request.end(body);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line === '') continue;
        let message;
        try {
            message = JSON.parse(line);
        } catch (error) {
            write(rpcError(null, -32700, 'Parse error'));
            continue;
        }
        forward(message);
    }
});
process.stdin.on('end', function () { process.exit(0); });
