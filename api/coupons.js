// /api/coupons — cupons VIP do ELEVATE, gerenciados pela coordenacao no servidor
//
// Antes os cupons viviam no navegador e havia 4 codigos fixos no proprio HTML:
// qualquer pessoa que abrisse o codigo-fonte virava VIP de graca. Agora:
//   GET                          -> lista os cupons (painel)
//   POST { action: 'criar'   }   -> cria/atualiza um cupom (codigo, validade em dias, usos, tipo)
//   POST { action: 'excluir' }   -> remove o cupom
//   POST { action: 'resgatar'}   -> o aluno resgata: valida no servidor e o VIP e concedido aqui
import crypto from 'crypto';

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
const COL_CUPONS = 'elevate_coupons';
const COL_ALUNOS = 'elevate_students';
const TIMEOUT_MS = 8000;

const base = (col) => '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + col;
const docIdAluno = (email) => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
const idCupom = (code) => String(code).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
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
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
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
        try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = null; }
        return { ok: res.ok, status: res.status, body: json, raw: texto };
    } catch (err) {
        return { ok: false, status: 0, body: null, raw: String(err && err.message) };
    } finally { clearTimeout(timer); }
}

function objDoc(doc) { const o = {}; for (const [k, v] of Object.entries(doc.fields || {})) o[k] = fromValue(v); return o; }

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(204).end();

    try {
        // ---------- painel: listar cupons ----------
        if (req.method === 'GET') {
            const r = await fs(base(COL_CUPONS) + '?pageSize=200');
            const cupons = ((r.body && r.body.documents) || []).map(objDoc)
                .map(c => ({
                    code: c.code,
                    tipo: c.tipo || 'VIP',
                    usos: Number(c.usos || 0),
                    maxUsos: Number(c.maxUsos || 0),
                    validade: c.validade || null,
                    criadoEm: c.criadoEm || null,
                    ativo: c.ativo !== false,
                    expirado: !!(c.validade && new Date(c.validade).getTime() < Date.now())
                }))
                .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
            return res.status(200).json({ ok: true, total: cupons.length, cupons });
        }

        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const acao = String(body.action || '').trim();

        // ---------- painel: criar cupom ----------
        if (acao === 'criar') {
            const code = idCupom(body.code || '');
            if (!code || code.length < 4) return res.status(400).json({ ok: false, error: 'Código muito curto (mínimo 4 caracteres).' });

            const dias = Number(body.dias || 0);
            const maxUsos = Number(body.maxUsos || 0);
            const agora = new Date();
            const validade = dias > 0 ? new Date(agora.getTime() + dias * 86400000).toISOString() : null;

            const cupom = {
                code,
                tipo: String(body.tipo || 'VIP'),
                usos: 0,
                maxUsos: maxUsos > 0 ? maxUsos : 0,
                validade,
                ativo: true,
                criadoEm: agora.toISOString()
            };
            const r = await fs(base(COL_CUPONS) + '/' + code, { method: 'PATCH', body: JSON.stringify({ fields: Object.fromEntries(Object.entries(cupom).map(([k, v]) => [k, toValue(v)])) }) });
            if (!r.ok) return res.status(500).json({ ok: false, error: 'Falha ao gravar o cupom.' });
            return res.status(200).json({ ok: true, cupom, message: 'Cupom ' + code + ' criado.' });
        }

        // ---------- painel: excluir cupom ----------
        if (acao === 'excluir') {
            const code = idCupom(body.code || '');
            if (!code) return res.status(400).json({ ok: false, error: 'Código não informado.' });
            const r = await fs(base(COL_CUPONS) + '/' + code, { method: 'DELETE' });
            if (!r.ok) return res.status(404).json({ ok: false, error: 'Cupom não encontrado.' });
            return res.status(200).json({ ok: true, message: 'Cupom ' + code + ' excluído.' });
        }

        // ---------- aluno: resgatar cupom ----------
        if (acao === 'resgatar') {
            const email = String(body.email || '').trim().toLowerCase();
            const code = idCupom(body.code || '');
            if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'E-mail não informado.' });
            if (!code) return res.status(400).json({ ok: false, error: 'Informe o código do cupom.' });

            const rc = await fs(base(COL_CUPONS) + '/' + code);
            if (rc.status === 404 || !rc.ok) {
                console.log('[cupom] recusado (nao existe): ' + code + ' | aluno=' + email);
                return res.status(200).json({ ok: false, error: 'Cupom inválido.' });
            }
            const cupom = objDoc(rc.body);
            if (cupom.ativo === false) return res.status(200).json({ ok: false, error: 'Este cupom não está mais ativo.' });
            if (cupom.validade && new Date(cupom.validade).getTime() < Date.now()) {
                return res.status(200).json({ ok: false, error: 'Este cupom expirou.' });
            }

            const jaUsou = Array.isArray(cupom.usou) ? cupom.usou : [];
            if (jaUsou.map(e => String(e).toLowerCase()).includes(email)) {
                return res.status(200).json({ ok: false, error: 'Você já usou este cupom.' });
            }
            const maxUsos = Number(cupom.maxUsos || 0);
            if (maxUsos > 0 && Number(cupom.usos || 0) >= maxUsos) {
                return res.status(200).json({ ok: false, error: 'Este cupom atingiu o limite de usos.' });
            }

            // concede o direito de acesso no SERVIDOR (vale em qualquer aparelho)
            const ra = await fs(base(COL_ALUNOS) + '/' + docIdAluno(email));
            if (!ra.ok || !ra.body || !ra.body.fields) {
                return res.status(200).json({ ok: false, error: 'Não encontrei seu cadastro. Abra o app novamente e tente de novo.' });
            }
            const aluno = objDoc(ra.body);
            const entitlement = { ...(aluno.entitlement || {}), isVip: true, cupom: code, updatedAt: new Date().toISOString() };
            const g = await fs(base(COL_ALUNOS) + '/' + docIdAluno(email) + '?updateMask.fieldPaths=entitlement', {
                method: 'PATCH', body: JSON.stringify({ fields: { entitlement: toValue(entitlement) } })
            });
            if (!g.ok) return res.status(500).json({ ok: false, error: 'Falha ao liberar o acesso.' });

            // registra o uso (uso unico por aluno)
            const novoUso = [...jaUsou, email];
            await fs(base(COL_CUPONS) + '/' + code + '?updateMask.fieldPaths=usos&updateMask.fieldPaths=usou', {
                method: 'PATCH',
                body: JSON.stringify({ fields: { usos: toValue(Number(cupom.usos || 0) + 1), usou: toValue(novoUso) } })
            });

            console.log('[cupom] aceito: ' + code + ' | aluno=' + email);
            return res.status(200).json({ ok: true, message: 'Cupom validado! Acesso VIP liberado nesta conta.' });
        }

        return res.status(400).json({ ok: false, error: 'Ação inválida: ' + acao });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Erro no servidor: ' + err.message });
    }
}
