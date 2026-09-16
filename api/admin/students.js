// /api/admin/students — lista de alunos do ELEVATE para o painel do instrutor
//
// Le do servidor (Firestore), nao do navegador: por isso o aluno aparece no painel
// mesmo tendo se cadastrado no celular.
//   GET                       -> lista os alunos
//   POST { email, isVip }     -> concede ou remove o VIP (direito de acesso)
import crypto from 'crypto';

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
const COLECAO = 'elevate_students';
const TIMEOUT_MS = 8000;

const basePath = '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + COLECAO;

function docId(email) {
    return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
}

function fromValue(v) {
    if (!v) return null;
    if ('nullValue' in v) return null;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('stringValue' in v) return v.stringValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(x); return o; }
    return null;
}

function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') { const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = toValue(x); return { mapValue: { fields } }; }
    return { stringValue: String(v) };
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
            const r = await fsRequest(basePath + '?pageSize=300');
            const docs = (r.body && r.body.documents) || [];
            const students = docs.map(d => {
                const o = {};
                for (const [k, v] of Object.entries(d.fields || {})) o[k] = fromValue(v);
                const ent = o.entitlement || {};
                const prog = o.progress || {};
                return {
                    email: o.email || '',
                    displayName: o.name || 'Aluno',
                    isVip: !!ent.isVip,
                    xp: Number(prog.xp || 0),
                    streak: Number(prog.streak || 0),
                    hearts: Number(prog.hearts || 0),
                    learningLanguage: prog.learningLanguage || 'en',
                    completedLessonsCount: (prog.progressByLanguage && prog.progressByLanguage.en && prog.progressByLanguage.en.completedLessons ? prog.progressByLanguage.en.completedLessons.length : 0)
                        + (prog.progressByLanguage && prog.progressByLanguage.es && prog.progressByLanguage.es.completedLessons ? prog.progressByLanguage.es.completedLessons.length : 0),
                    lastActiveAt: o.updatedAt || null,
                    createdAt: o.createdAt || null
                };
            }).sort((a, b) => String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || '')));

            return res.status(200).json({ ok: true, total: students.length, students });
        }

        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            const email = String(body.email || '').trim().toLowerCase();
            const conceder = !!body.isVip;
            if (!email) return res.status(400).json({ ok: false, error: 'E-mail do aluno não informado.' });

            const atual = await fsRequest(basePath + '/' + docId(email));
            if (atual.status === 404) return res.status(404).json({ ok: false, error: 'Aluno não encontrado na nuvem (peça para ele abrir o app uma vez).' });

            const existente = {};
            for (const [k, v] of Object.entries((atual.body && atual.body.fields) || {})) existente[k] = fromValue(v);

            const entitlement = { ...(existente.entitlement || {}), isVip: conceder, updatedAt: new Date().toISOString() };
            const patch = await fsRequest(basePath + '/' + docId(email) + '?updateMask.fieldPaths=entitlement', {
                method: 'PATCH',
                body: JSON.stringify({ fields: { entitlement: toValue(entitlement) } })
            });
            if (!patch.ok) return res.status(500).json({ ok: false, error: 'Falha ao gravar o VIP.' });

            return res.status(200).json({
                ok: true,
                email,
                isVip: conceder,
                message: conceder ? 'VIP concedido! O aluno recebe ao abrir o app.' : 'VIP removido.'
            });
        }

        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Erro no servidor: ' + err.message });
    }
}
