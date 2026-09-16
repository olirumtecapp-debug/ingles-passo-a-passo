// /api/student/progress — progresso do aluno do ELEVATE na nuvem
//
// Padrao de acesso dos projetos:
//   GET  ?email=&pin=            -> devolve o progresso (exige o PIN quando a conta tem um)
//   POST { action: 'save' }      -> grava o progresso, aceita pin, gera codigo de recuperacao
//   POST { action: 'recover' }   -> { email, code, newPin? } devolve o progresso
import crypto from 'crypto';
import { enviarEmail, emailConfigurado, modeloCodigo } from '../_email.js';

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
const COLECAO = 'elevate_students';
const TIMEOUT_MS = 8000;

const basePath = '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + COLECAO;

function segredo() {
    return process.env.ADMIN_AUTH_SECRET || '';
}

function hash(valor) {
    return crypto.createHmac('sha256', segredo()).update(String(valor).trim()).digest('hex');
}

function gerarCodigo() {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numeros = '23456789';
    let codigo = '';
    for (let i = 0; i < 3; i++) codigo += letras[crypto.randomInt(0, letras.length)];
    for (let i = 0; i < 3; i++) codigo += numeros[crypto.randomInt(0, numeros.length)];
    return codigo;
}

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
            const pin = String(req.query.pin || '').trim();
            if (!email) return res.status(400).json({ ok: false, error: 'E-mail não informado.' });

            const r = await fsRequest(basePath + '/' + docId(email));
            if (r.status === 404) return res.status(200).json({ ok: true, isNew: true, progress: null });
            if (!r.ok || !r.body || !r.body.fields) return res.status(200).json({ ok: false, error: 'Não foi possível consultar o progresso.' });

            const registro = docToObject(r.body);

            if (registro.pinHash) {
                if (!segredo()) return res.status(200).json({ ok: false, error: 'Servidor sem segredo configurado.' });
                if (!pin) return res.status(200).json({ ok: false, precisaPin: true, error: 'Esta conta tem PIN. Informe o PIN para carregar o progresso.' });
                if (hash(pin) !== registro.pinHash) return res.status(200).json({ ok: false, pinInvalido: true, error: 'PIN incorreto.' });
            }

            return res.status(200).json({
                ok: true,
                isNew: false,
                temPin: !!registro.pinHash,
                name: registro.name || null,
                email: registro.email || email,
                progress: registro.progress || null,
                entitlement: registro.entitlement || { isVip: false },
                updatedAt: registro.updatedAt || null
            });
        }

        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            const email = String(body.email || '').trim().toLowerCase();
            const acao = String(body.action || 'save');
            if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'E-mail válido é obrigatório.' });

            const anterior = await fsRequest(basePath + '/' + docId(email));
            const existia = anterior.ok && anterior.body && anterior.body.fields;
            const registroAnterior = existia ? docToObject(anterior.body) : null;

            // ---- recuperacao pelo codigo ----
            if (acao === 'recover') {
                const codigo = String(body.code || '').trim().toUpperCase().replace(/[\s-]/g, '');
                const novoPin = String(body.newPin || '').trim();
                if (!existia) return res.status(200).json({ ok: false, error: 'Conta não encontrada com este e-mail.' });
                if (!registroAnterior.recoveryHash) return res.status(200).json({ ok: false, error: 'Esta conta ainda não tem código de recuperação.' });
                if (!segredo()) return res.status(200).json({ ok: false, error: 'Servidor sem segredo configurado.' });
                if (!codigo || hash(codigo) !== registroAnterior.recoveryHash) return res.status(200).json({ ok: false, error: 'Código de recuperação incorreto.' });
                if (novoPin && !/^\d{4,6}$/.test(novoPin)) return res.status(200).json({ ok: false, error: 'O novo PIN deve ter de 4 a 6 dígitos.' });

                const atualizado = { ...registroAnterior, updatedAt: new Date().toISOString() };
                if (novoPin) atualizado.pinHash = hash(novoPin);
                const g = await fsRequest(basePath + '/' + docId(email), { method: 'PATCH', body: JSON.stringify({ fields: toFields(atualizado) }) });
                if (!g.ok) return res.status(500).json({ ok: false, error: 'Falha ao recuperar o progresso.' });
                return res.status(200).json({ ok: true, message: novoPin ? 'Progresso recuperado e PIN atualizado!' : 'Progresso recuperado!', name: atualizado.name, progress: atualizado.progress || null, temPin: !!atualizado.pinHash });
            }

            // ---- enviar um codigo novo por e-mail (o aluno recupera sozinho) ----
            if (acao === 'enviar-codigo') {
                if (!emailConfigurado()) {
                    return res.status(200).json({ ok: false, naoConfigurado: true, error: 'O envio de e-mail ainda nao esta ligado. Use a opcao de falar com a coordenacao.' });
                }
                if (!segredo()) return res.status(200).json({ ok: false, error: 'Servidor sem segredo configurado.' });

                if (!existia) {
                    return res.status(200).json({ ok: false, semMatricula: true, success: false, error: 'Não encontrei matrícula com este e-mail. Confira o endereço ou use a opção de falar com a coordenação.' });
                }

                const cod = gerarCodigo();
                const atual = { ...registroAnterior, recoveryHash: hash(cod), recoveryCreatedAt: new Date().toISOString() };
                const g = await fsRequest(basePath + '/' + docId(email), { method: 'PATCH', body: JSON.stringify({ fields: toFields(atual) }) });
                if (!g.ok) return res.status(200).json({ ok: false, error: 'Falha ao gerar o codigo.' });

                const modelo = modeloCodigo({ nome: registroAnterior.name, codigo: cod, plataforma: 'ELEVATE' });
                const envio = await enviarEmail({ para: email, assunto: modelo.titulo + ' - ELEVATE', texto: modelo.texto, html: modelo.html });
                if (!envio.ok) return res.status(200).json({ ok: false, error: envio.error || 'Nao foi possivel enviar o e-mail agora.' });

                return res.status(200).json({ ok: true, message: 'Codigo enviado para ' + email + '. Confira a caixa de entrada (e o spam).' });
            }

            // ---- a coordenacao redefine o acesso do aluno ----
            if (acao === 'admin-resetar') {
                if (!segredo()) return res.status(200).json({ ok: false, error: 'Servidor sem segredo configurado.' });
                if (!existia) return res.status(404).json({ ok: false, error: 'Aluno nao encontrado.' });

                const cod = gerarCodigo();
                const atual = { ...registroAnterior, updatedAt: new Date().toISOString() };
                delete atual.pinHash;
                atual.recoveryHash = hash(cod);
                atual.recoveryCreatedAt = new Date().toISOString();
                atual.acessoRedefinidoEm = new Date().toISOString();
                const g = await fsRequest(basePath + '/' + docId(email), { method: 'PATCH', body: JSON.stringify({ fields: toFields(atual) }) });
                if (!g.ok) return res.status(500).json({ ok: false, error: 'Falha ao redefinir o acesso.' });

                return res.status(200).json({ ok: true, email, recoveryCode: cod, message: 'Acesso redefinido. O aluno entra so com o e-mail. Entregue o novo codigo a ele.' });
            }

            // ---- pedido de ajuda (chega por e-mail para a coordenacao) ----
            if (acao === 'ajuda') {
                if (!emailConfigurado()) {
                    return res.status(200).json({ ok: false, naoConfigurado: true, error: 'Canal de ajuda indisponivel agora. Tente pelo e-mail contato@creativeam.com.br.' });
                }
                const nomeAluno = String(body.nome || '').trim() || 'Aluno';
                const emailAluno = String(body.emailAluno || email || '').trim().toLowerCase();
                const recado = String(body.recado || '').trim();
                if (!recado) return res.status(400).json({ ok: false, error: 'Escreva o que aconteceu.' });

                const destino = process.env.EMAIL_RESPOSTA || 'contato@creativeam.com.br';
                const texto = [
                    'Pedido de ajuda para entrar no ELEVATE',
                    '',
                    'Nome: ' + nomeAluno,
                    'E-mail do aluno: ' + emailAluno,
                    'Conta na plataforma: ' + email,
                    '',
                    'Recado:',
                    recado
                ].join('\n');
                const envio = await enviarEmail({ para: destino, assunto: 'ELEVATE - ajuda para entrar (' + nomeAluno + ')', texto: texto });
                if (!envio.ok) return res.status(200).json({ ok: false, error: 'Nao foi possivel enviar agora. Escreva para contato@creativeam.com.br.' });

                return res.status(200).json({ ok: true, message: 'Pedido enviado! A coordenacao responde para o e-mail que voce deixou.' });
            }

            // ---- painel concede ou remove o VIP ----
            if (acao === 'vip') {
                if (!existia) return res.status(404).json({ ok: false, error: 'Aluno nao encontrado na nuvem.' });
                const conceder = !!body.isVip;
                const entitlement = { ...(registroAnterior.entitlement || {}), isVip: conceder, updatedAt: new Date().toISOString() };
                const g = await fsRequest(basePath + '/' + docId(email) + '?updateMask.fieldPaths=entitlement', { method: 'PATCH', body: JSON.stringify({ fields: { entitlement: toFields(entitlement) } }) });
                if (!g.ok) return res.status(500).json({ ok: false, error: 'Falha ao gravar o VIP.' });
                return res.status(200).json({ ok: true, email, isVip: conceder, message: conceder ? 'VIP concedido!' : 'VIP removido.' });
            }

            // ---- gravacao ----
            const progresso = body.progress;
            // o direito de acesso (VIP) e definido pelo painel, nunca pelo aparelho do aluno:
            // remove essas chaves do que chega para nao apagar o VIP concedido
            if (progresso && typeof progresso === 'object') {
                delete progresso.isVip;
                delete progresso.unlockedModules;
                delete progresso.vipCouponUsed;
            }
            const nome = String(body.name || '').trim() || 'Aluno';
            const pinInformado = String(body.pin || '').trim();
            if (!progresso || typeof progresso !== 'object') return res.status(400).json({ ok: false, error: 'Progresso não informado.' });
            if (pinInformado && !/^\d{4,6}$/.test(pinInformado)) return res.status(200).json({ ok: false, error: 'O PIN deve ter de 4 a 6 dígitos.' });

            const agora = new Date().toISOString();
            const registro = {
                email,
                name: nome,
                progress: progresso,
                createdAt: (registroAnterior && registroAnterior.createdAt) || agora,
                updatedAt: agora
            };
            if (registroAnterior && registroAnterior.pinHash) registro.pinHash = registroAnterior.pinHash;
            if (registroAnterior && registroAnterior.recoveryHash) registro.recoveryHash = registroAnterior.recoveryHash;
            if (registroAnterior && registroAnterior.entitlement) registro.entitlement = registroAnterior.entitlement;

            let codigoNovo = null;
            if (pinInformado && segredo()) registro.pinHash = hash(pinInformado);
            if (!registro.recoveryHash && segredo()) {
                codigoNovo = gerarCodigo();
                registro.recoveryHash = hash(codigoNovo);
                registro.recoveryCreatedAt = agora;
            }

            const gravar = await fsRequest(basePath + '/' + docId(email), { method: 'PATCH', body: JSON.stringify({ fields: toFields(registro) }) });
            if (!gravar.ok) return res.status(500).json({ ok: false, error: 'Falha ao gravar o progresso na nuvem.' });

            const resposta = { ok: true, isNew: !existia, temPin: !!registro.pinHash, message: existia ? 'Progresso atualizado na nuvem.' : 'Progresso criado na nuvem.' };
            if (codigoNovo) {
                resposta.recoveryCode = codigoNovo;
                resposta.avisoCodigo = 'Guarde este código: é com ele que você recupera seu progresso em outro aparelho.';
            }
            return res.status(200).json(resposta);
        }

        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Erro no servidor: ' + err.message });
    }
}
