// api/_pagamentos.js — registro de pagamentos confirmados do Asaas (Firestore)
//
// Antes a aprovacao ficava na memoria do processo: em serverless cada chamada pode cair em
// outra instancia e o site nunca "via" o pagamento. Agora fica no banco e vale sempre.

const crypto = require('crypto');

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
const COLECAO = 'elevate_pagamentos';
const TIMEOUT_MS = 8000;

const basePath = () => '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + COLECAO;

function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'object') { const f = {}; for (const [k, x] of Object.entries(v)) f[k] = toValue(x); return { mapValue: { fields: f } }; }
    return { stringValue: String(v) };
}

function fromValue(v) {
    if (!v) return null;
    if ('nullValue' in v) return null;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('stringValue' in v) return v.stringValue;
    if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(x); return o; }
    return null;
}

async function fs(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch('https://firestore.googleapis.com' + path + (path.includes('?') ? '&' : '?') + 'key=' + API_KEY, {
            ...options, signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const texto = await res.text();
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch (e) {}
        return { ok: res.ok, status: res.status, body: json };
    } catch (err) {
        return { ok: false, status: 0, body: null };
    } finally { clearTimeout(timer); }
}

async function registrarPagamento(registro) {
    const id = 'pg_' + (registro.timestamp || Date.now()) + '_' + crypto.randomBytes(3).toString('hex');
    const res = await fs(basePath() + '/' + id, { method: 'PATCH', body: JSON.stringify({ fields: Object.fromEntries(Object.entries(registro).map(([k, v]) => [k, toValue(v)])) }) });
    return res.ok;
}

async function listarPagamentos() {
    const res = await fs(basePath() + '?pageSize=200');
    const docs = (res.body && res.body.documents) || [];
    return docs.map(d => {
        const o = { _id: String(d.name || '').split('/').pop() };
        for (const [k, v] of Object.entries(d.fields || {})) o[k] = fromValue(v);
        return o;
    }).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

async function limparPagamentosAntigos(maxAgeMs = 3600000) {
    const limite = Date.now() - maxAgeMs;
    const lista = await listarPagamentos();
    let n = 0;
    for (const p of lista) {
        if (Number(p.timestamp || 0) < limite) { await fs(basePath() + '/' + p._id, { method: 'DELETE' }); n++; }
    }
    return n;
}

module.exports = { registrarPagamento, listarPagamentos, limparPagamentosAntigos };
