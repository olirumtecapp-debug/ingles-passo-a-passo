// api/asaas-webhook.js - Webhook Oficial do Asaas para ELEVATE
let recentApprovals = globalThis.__elevate_approvals || [];
globalThis.__elevate_approvals = recentApprovals;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type, asaas-access-token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Consulta do frontend (GET) para verificar se o PIX acabou de ser pago
  if (req.method === 'GET') {
    const { email, value } = req.query;
    const now = Date.now();
    
    // Procura aprovação recente (últimos 15 minutos)
    const match = recentApprovals.find(item => {
      const isFresh = (now - item.timestamp) < 15 * 60 * 1000;
      if (!isFresh) return false;
      if (email && item.customerEmail && item.customerEmail.toLowerCase() === email.toLowerCase()) return true;
      if (value && Math.abs(parseFloat(item.value) - parseFloat(value)) < 0.1) return true;
      return true; // Se estiver no modal ativo e houver aprovação recente
    });

    if (match) {
      return res.status(200).json({
        approved: true,
        event: match.event,
        paymentId: match.paymentId,
        value: match.value,
        timestamp: match.timestamp
      });
    }

    return res.status(200).json({ approved: false, message: 'Aguardando confirmação do Asaas' });
  }

  // Notificação do Asaas (POST)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const event = body.event;
      const payment = body.payment || {};

      console.log(`[Asaas Webhook] Evento: ${event}, ID: ${payment.id}, Valor: ${payment.value}`);

      const isApprovedEvent = [
        'PAYMENT_RECEIVED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED_IN_CASH'
      ].includes(event);

// Concede o VIP no servidor (Firestore) para o e-mail que pagou.
async function concederVipNoServidor(email) {
  if (!email || !String(email).includes('@')) return false;
  const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBUHGXoUMg0bV3EdmfpfmVAEYMLQceqkQc';
  const PROJ = process.env.FIREBASE_PROJECT_ID || 'expedicao-brasil';
  const crypto = require('crypto');
  const id = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
  const base = 'https://firestore.googleapis.com/v1/projects/' + PROJ + '/databases/(default)/documents/elevate_students/' + id;
  try {
    const atual = await fetch(base + '?key=' + API_KEY);
    if (atual.status === 404) return false;
    const doc = await atual.json();
    const anterior = (doc.fields && doc.fields.entitlement && doc.fields.entitlement.mapValue && doc.fields.entitlement.mapValue.fields) || {};
    const fields = { ...anterior, isVip: { booleanValue: true }, pagoEm: { stringValue: new Date().toISOString() } };
    const patch = await fetch(base + '?updateMask.fieldPaths=entitlement&key=' + API_KEY, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { entitlement: { mapValue: { fields } } } })
    });
    return patch.ok;
  } catch (e) { return false; }
}

      if (isApprovedEvent) {
        const approvalRecord = {
          paymentId: payment.id,
          event: event,
          value: payment.value,
          billingType: payment.billingType,
          customerEmail: payment.customer?.email || null,
          timestamp: Date.now()
        };

        recentApprovals.unshift(approvalRecord);

        // quem pagou recebe o acesso no SERVIDOR (vale em qualquer aparelho, nao se perde)
        if (approvalRecord.customerEmail) {
          concederVipNoServidor(approvalRecord.customerEmail).then(ok => {
            console.log('[Asaas Webhook] VIP concedido para ' + approvalRecord.customerEmail + '? ' + ok);
          });
        }
        if (recentApprovals.length > 50) recentApprovals.pop();
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[Asaas Webhook] Erro:', err);
      return res.status(200).json({ received: true, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
