const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, providerStatusToOrderStatus } = require('../src/state');

test('state machine permits payment progression and rejects regressions', () => {
  assert.equal(canTransition('pending', 'paid'), true);
  assert.equal(canTransition('paid', 'settled'), true);
  assert.equal(canTransition('paid', 'pending'), false);
  assert.equal(canTransition('expired', 'paid'), false);
});

test('provider statuses map to unified order statuses', () => {
  assert.equal(providerStatusToOrderStatus('settlement'), 'paid');
  assert.equal(providerStatusToOrderStatus('completed'), 'paid');
  assert.equal(providerStatusToOrderStatus('expired'), 'expired');
  assert.equal(providerStatusToOrderStatus('processing'), 'pending');
});
