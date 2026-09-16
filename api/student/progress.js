// /api/student/progress — progresso do aluno do ELEVATE na nuvem
//
// Uma unica funcao para registro, gravacao e leitura (limite de 12 funcoes na Vercel):
//   GET  ?email=               -> devolve o progresso salvo
//   POST { action: 'save' }    -> grava/atualiza o progresso
//
// O aluno e identificado pelo e-mail; a leitura devolve o registro inteiro para o
// navegador restaurar (troca de navegador ou de aparelho).
import crypto from 'crypto';

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
const COLECAO = 'elevate_students';
const TIMEOUT_MS = 8000;

const basePath = '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + COLECAO;

function docId(email) {
    return crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 32);
}

function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') {
        const fields = {};
        for (const [k, x] of Object.entries(v)) {
            if (/[.\[\]\/~*]/.test(k)) continue;
            fields[k] = toValue(x);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
}

function fromValue(v) {
    if (!v) return null;
    if ('nullValue' in v) return null;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('stringValue' in v) return v.stringValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) {
        const o = {};
        for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(x);
        return o;
    }
    return null;
}

function toFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (/[.\[\]\/~*]/.test(k)) continue;
        fields[k] = toValue(v);
    }
    return fields;
}

function docToObject(doc) {
    const o = {};
    for (const [k, v] of Object.entries(doc.fields || {})) o[k] = fromValue(v);
    return o;
}

async function fsRequest(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch('https://firestore.googleapis.com' + path + (path.includes('?') ? '&' : '?') + 'key=' + API_KEY, {
            ...options,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const texto = await res.text();
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = null; }
        return { ok: res.ok, status: res.status, body: json, raw: texto };
    } catch (err) {
        return { ok: false, status: 0, body: null, raw: String(err && err.message) };
    } finally {
        clearTimeout(timer);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(204).end();

    try {
        if (req.method === 'GET') {
            const email = String(req.query.email || '').trim().toLowerCase();
            if (!email) return res.status(400).json({ ok: false, error: 'E-mail não informado.' });

            const r = await fsRequest(basePath + '/' + docId(email));
            if (r.status === 404) return res.status(200).json({ ok: true, isNew: true, progress: null });
            if (!r.ok || !r.body || !r.body.fields) {
                return res.status(200).json({ ok: false, error: 'Não foi possível consultar o progresso.' });
            }

            const registro = docToObject(r.body);
            return res.status(200).json({
                ok: true,
                isNew: false,
                name: registro.name || null,
                email: registro.email || email,
                progress: registro.progress || null,
                updatedAt: registro.updatedAt || null
            });
        }

        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            const email = String(body.email || '').trim().toLowerCase();
            const nome = String(body.name || '').trim() || 'Aluno';
            const progresso = body.progress;
            const acao = String(body.action || 'save');

            if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'E-mail válido é obrigatório.' });
            if (!progresso || typeof progresso !== 'object') return res.status(400).json({ ok: false, error: 'Progresso não informado.' });

            const anterior = await fsRequest(basePath + '/' + docId(email));
            const existia = anterior.ok && anterior.body && anterior.body.fields;
            const registroAnterior = existia ? docToObject(anterior.body) : null;

            const agora = new Date().toISOString();
            const registro = {
                email,
                name: nome,
                progress: progresso,
                createdAt: (registroAnterior && registroAnterior.createdAt) || agora,
                updatedAt: agora
            };

            const gravar = await fsRequest(basePath + '/' + docId(email), {
                method: 'PATCH',
                body: JSON.stringify({ fields: toFields(registro) })
            });

            if (!gravar.ok) return res.status(500).json({ ok: false, error: 'Falha ao gravar o progresso na nuvem.' });

            return res.status(200).json({
                ok: true,
                isNew: !existia,
                action: acao,
                message: existia ? 'Progresso atualizado na nuvem.' : 'Progresso criado na nuvem.',
                updatedAt: agora
            });
        }

        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Erro no servidor: ' + err.message });
    }
}
