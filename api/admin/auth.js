// /api/admin/auth — login e troca de senha do painel do ELEVATE (Ingles)
//
// Uma unica funcao atende as tres necessidades (limite de 12 funcoes do plano gratuito):
//   GET                        -> informa se o dono ja criou uma senha propria
//   POST { action: 'login' }   -> valida usuario e senha
//   POST { action: 'set-password', currentPassword, newPassword } -> troca a senha
//
// A senha fica no Firestore como HMAC-SHA256 com o segredo do servidor (ADMIN_AUTH_SECRET).
// Nenhuma senha fica no HTML do site.
import crypto from 'crypto';

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
const COLECAO = 'ingles_admin_auth';
const USUARIOS_OK = ['admplus'];
const SENHA_PADRAO = '16Bl33@p';
const MIN_CARACTERES = 6;
const TIMEOUT_MS = 8000;

const basePath = '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + COLECAO;

function hashSenha(senha, segredo) {
    return crypto.createHmac('sha256', segredo).update(String(senha)).digest('hex');
}

function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') {
        const fields = {};
        for (const [k, x] of Object.entries(v)) fields[k] = toValue(x);
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
    if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(x); return o; }
    return null;
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

async function getAuth() {
    const res = await fsRequest(basePath + '/main');
    if (res.ok && res.body && res.body.fields) {
        const o = {};
        for (const [k, v] of Object.entries(res.body.fields)) o[k] = fromValue(v);
        return o;
    }
    return null;
}

async function salvarAuth(registro) {
    const fields = {};
    for (const [k, v] of Object.entries(registro)) fields[k] = toValue(v);
    const res = await fsRequest(basePath + '/main', { method: 'PATCH', body: JSON.stringify({ fields }) });
    return res.ok;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const auth = await getAuth();
        const temSenhaPropria = !!(auth && auth.hash);
        const segredo = process.env.ADMIN_AUTH_SECRET || '';

        const body = req.method === 'POST'
            ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))
            : {};
        const acao = String(body.action || (req.method === 'GET' ? 'status' : 'login'));

        if (req.method === 'GET' || acao === 'status') {
            return res.status(200).json({ ok: true, hasCustomPassword: temSenhaPropria, updatedAt: (auth && auth.updatedAt) || null });
        }

        if (!segredo) {
            return res.status(200).json({ ok: false, error: 'Servidor sem segredo configurado. Avise o suporte tecnico.' });
        }

        if (acao === 'login') {
            const usuario = String(body.user || '').trim().toLowerCase();
            const senha = String(body.password || '');
            const usuarioOk = USUARIOS_OK.includes(usuario);
            const senhaOk = temSenhaPropria
                ? hashSenha(senha, segredo) === auth.hash
                : senha === SENHA_PADRAO;

            return res.status(200).json({
                ok: usuarioOk && senhaOk,
                hasCustomPassword: temSenhaPropria,
                message: (usuarioOk && senhaOk) ? 'Acesso liberado.' : 'Usuário ou senha incorretos.'
            });
        }

        if (acao === 'set-password') {
            const senhaAtual = String(body.currentPassword || '');
            const senhaNova = String(body.newPassword || '');

            if (senhaNova.trim().length < MIN_CARACTERES) {
                return res.status(200).json({ ok: false, error: 'A nova senha precisa ter pelo menos ' + MIN_CARACTERES + ' caracteres.' });
            }

            const atualOk = temSenhaPropria
                ? hashSenha(senhaAtual, segredo) === auth.hash
                : senhaAtual === SENHA_PADRAO;

            if (!atualOk) return res.status(200).json({ ok: false, error: 'Senha atual incorreta.' });

            const gravou = await salvarAuth({ hash: hashSenha(senhaNova.trim(), segredo), updatedAt: new Date().toISOString() });
            if (!gravou) return res.status(200).json({ ok: false, error: 'Falha ao gravar a nova senha.' });

            return res.status(200).json({ ok: true, hasCustomPassword: true, message: 'Senha atualizada com sucesso!' });
        }

        return res.status(200).json({ ok: false, error: 'Acao desconhecida: ' + acao });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Erro no servidor: ' + err.message });
    }
}
