// api/asaas-webhook.js — Webhook do Asaas para ELEVATE
//
// A aprovacao vai para o Firestore (nao mais para a memoria do processo): em serverless
// cada chamada pode cair em outra instancia e o site nunca veria o pagamento.
const { registrarPagamento, listarPagamentos, limparPagamentosAntigos } = require('./_pagamentos.js');

const crypto = require('crypto');

// Concede o VIP no Firestore para o e-mail que pagou
async function concederVipNoServidor(email) {
  if (!email || !String(email).includes('@')) return false;
  const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
  const PROJ = 'expedicao-brasil';
  const id = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
  const base = 'https://firestore.googleapis.com/v1/projects/' + PROJ + '/databases/(default)/documents/elevate_students/' + id;
  try {
    const atual = await fetch(base + '?key=' + API_KEY);
    if (atual.status === 404) return false;
    const doc = await atual.json();
    const anterior = (doc.fields && doc.fields.entitlement && doc.fields.entitlement.mapValue && doc.fields.entitlement.mapValue.fields) || {};
    const fields = { ...anterior, isVip: { booleanValue: true }, pagoEm: { stringValue: new Date().toISOString() } };
    const patch = await fetch(base + '?updateMask.fieldPaths=entitlement&key=' + API_KEY, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { entitlement: { mapValue: { fields } } } })
    });
    return patch.ok;
  } catch (e) { return false; }
}

const EVENTOS_APROVADOS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'];
const JANELA_MS = 15 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, asaas-access-token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const { value, since } = req.query || {};
    const desde = parseInt(since || '0', 10) || 0;
    const pagamentos = await listarPagamentos();
    const agora = Date.now();
    const achou = pagamentos.find(p => {
      if (desde && Number(p.timestamp) < desde) return false;
      if ((agora - Number(p.timestamp)) >= JANELA_MS) return false;
      if (value) return Math.abs(parseFloat(p.value) - parseFloat(value)) < 0.1;
      return true;
    });
    if (achou) return res.status(200).json({ approved: true, event: achou.event, paymentId: achou.paymentId, value: achou.value, timestamp: achou.timestamp });
    return res.status(200).json({ approved: false, message: 'Aguardando confirmação do Asaas' });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const event = body.event;
      const payment = body.payment || {};
      if (EVENTOS_APROVADOS.includes(event)) {
        const registro = {
          paymentId: payment.id || null,
          event: event,
          value: payment.value || null,
          billingType: payment.billingType || null,
          customerEmail: (payment.customer && payment.customer.email) || null,
          timestamp: Date.now()
        };
        await registrarPagamento(registro);
        await limparPagamentosAntigos();
        console.log('[Asaas] pagamento confirmado: ' + registro.paymentId + ' | ' + registro.customerEmail);
        // quem pagou recebe o VIP no SERVIDOR (vale em qualquer aparelho)
        if (registro.customerEmail) {
          concederVipNoServidor(registro.customerEmail).then(ok => console.log('[Asaas] VIP concedido para ' + registro.customerEmail + ': ' + ok));
        }
      }
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[Asaas] erro:', err && err.message);
      return res.status(200).json({ received: true, error: err && err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
