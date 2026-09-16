// lib/_email.js â€” envio de e-mail transacional
//
// Usa a API do Resend (https://resend.com) por HTTPS puro, sem dependencia extra.
// Precisa de duas variaveis de ambiente no projeto da Vercel:
//   RESEND_API_KEY  -> chave criada no painel do Resend
//   EMAIL_REMETENTE -> ex.: CreativeAM <contato@creativeam.com.br>
//
// Sem a chave, o envio fica desligado e as telas caem no canal manual
// ("falar com a coordenaÃ§Ã£o"), sem quebrar nada.

const URL_API = 'https://api.resend.com/emails';

export function emailConfigurado() {
    return !!(process.env.RESEND_API_KEY && process.env.EMAIL_REMETENTE);
}

export async function enviarEmail({ para, assunto, texto, html }) {
    const chave = process.env.RESEND_API_KEY;
    const remetente = process.env.EMAIL_REMETENTE;

    if (!chave || !remetente) {
        return { ok: false, naoConfigurado: true, error: 'Envio de e-mail nÃ£o configurado no servidor.' };
    }
    if (!para || !String(para).includes('@')) {
        return { ok: false, error: 'DestinatÃ¡rio invÃ¡lido.' };
    }

    try {
        const resposta = await fetch(URL_API, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + chave,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: remetente,
                to: [para],
                subject: assunto || 'CreativeAM',
                reply_to: process.env.EMAIL_RESPOSTA || undefined,
                text: texto || '',
                html: html || undefined
            })
        });

        const corpo = await resposta.text();
        if (!resposta.ok) {
            console.error('[email] falha no envio:', resposta.status, corpo.slice(0, 300));
            return { ok: false, status: resposta.status, error: 'Falha ao enviar o e-mail.' };
        }
        return { ok: true, id: (() => { try { return JSON.parse(corpo).id; } catch (e) { return null; } })() };
    } catch (err) {
        console.error('[email] erro de rede:', err && err.message);
        return { ok: false, error: 'Erro de rede ao enviar o e-mail.' };
    }
}

export function modeloCodigo({ nome, codigo, plataforma }) {
    const titulo = 'Seu cÃ³digo de recuperaÃ§Ã£o';
    const texto = [
        'OlÃ¡' + (nome ? ', ' + nome : '') + '!',
        '',
        'VocÃª pediu para recuperar o acesso Ã  ' + (plataforma || 'nossa plataforma') + '.',
        'Seu cÃ³digo Ã©: ' + codigo,
        '',
        'Entre no site, clique em "recuperar meu progresso" e informe este cÃ³digo.',
        'Se nÃ£o foi vocÃª que pediu, ignore este e-mail â€” nada muda na sua conta.',
        '',
        'CreativeAM â€” Ideias que ganham vida'
    ].join('\n');

    const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">' +
        '<h2 style="margin:0 0 8px">' + titulo + '</h2>' +
        '<p style="color:#475569;margin:0 0 16px">OlÃ¡' + (nome ? ', ' + nome : '') + '! VocÃª pediu para recuperar o acesso Ã  ' + (plataforma || 'nossa plataforma') + '.</p>' +
        '<p style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center;margin:0 0 16px">' + codigo + '</p>' +
        '<p style="color:#475569;margin:0 0 8px">Entre no site, clique em <strong>recuperar meu progresso</strong> e informe este cÃ³digo.</p>' +
        '<p style="color:#94a3b8;font-size:12px;margin:16px 0 0">Se nÃ£o foi vocÃª que pediu, ignore este e-mail â€” nada muda na sua conta.</p>' +
        '</div>';

    return { titulo, texto, html };
}
