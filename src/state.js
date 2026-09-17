const transitions = {
  pending: new Set(['paid', 'expired', 'failed']),
  paid: new Set(['settled']),
  settled: new Set(),
  expired: new Set(),
  failed: new Set(),
};

function canTransition(from, to) {
  return from === to || Boolean(transitions[from]?.has(to));
}

function providerStatusToOrderStatus(providerStatus) {
  const normalized = String(providerStatus || '').toLowerCase();
  if (['settlement', 'capture', 'paid', 'completed', 'confirmed'].includes(normalized)) return 'paid';
  if (['expire', 'expired', 'cancel', 'cancelled'].includes(normalized)) return 'expired';
  if (['deny', 'failure', 'failed', 'cancelled_by_user'].includes(normalized)) return 'failed';
  return 'pending';
}

module.exports = { canTransition, providerStatusToOrderStatus };
