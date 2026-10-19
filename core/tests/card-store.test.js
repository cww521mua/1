const assert = require('node:assert/strict');
const test = require('node:test');

const {
    DAY_MS,
    HOUR_MS,
    generateCardCode,
    normalizeTimeDuration,
    normalizeCard,
    computeNextExpiresAt,
    getQuotaValue,
    validateCardForUse,
} = require('../dist/models/card-store');

const NOW = 1_700_000_000_000;

test('generateCardCode returns 16 safe uppercase alphanumeric chars', () => {
    for (let i = 0; i < 50; i++) {
        const code = generateCardCode();
        assert.equal(code.length, 16);
        assert.match(code, /^[A-Z0-9]+$/);
        assert.doesNotMatch(code, /[0O1IL]/);
    }
});

test('normalizeTimeDuration resolves day and hour durations', () => {
    const day = normalizeTimeDuration({ durationValue: 30, durationUnit: 'day' });
    assert.equal(day.durationUnit, 'day');
    assert.equal(day.durationValue, 30);
    assert.equal(day.durationMs, 30 * DAY_MS);
    assert.ok(Math.abs(day.days - 30) < 1e-9);

    const hour = normalizeTimeDuration({ durationValue: 12, durationUnit: 'hour' });
    assert.equal(hour.durationUnit, 'hour');
    assert.equal(hour.durationMs, 12 * HOUR_MS);
});

test('normalizeTimeDuration resolves permanent cards from -1 or isPermanent', () => {
    for (const input of [{ durationValue: -1 }, { isPermanent: true }, { days: -1 }]) {
        const duration = normalizeTimeDuration(input);
        assert.equal(duration.isPermanent, true);
        assert.equal(duration.durationMs, null);
        assert.equal(duration.days, -1);
    }
});

test('normalizeTimeDuration falls back to 1 day on invalid values', () => {
    const duration = normalizeTimeDuration({ durationValue: 'abc' });
    assert.equal(duration.durationValue, 1);
    assert.equal(duration.durationMs, DAY_MS);
});

test('normalizeTimeDuration keeps legacy days field and allowZero flag', () => {
    const legacy = normalizeTimeDuration({ days: 7 });
    assert.equal(legacy.durationMs, 7 * DAY_MS);

    const zero = normalizeTimeDuration({ durationValue: 0, allowZero: true });
    assert.equal(zero.durationMs, 0);
});

test('normalizeCard normalizes time and quota cards', () => {
    const timeCard = normalizeCard({
        code: 'abcd-efgh-jkmn-pqrst',
        description: ' 月卡 ',
        type: 'time',
        durationValue: 30,
        durationUnit: 'day',
    });
    assert.equal(timeCard.code, 'ABCDEFGHJKMNPQRST');
    assert.equal(timeCard.description, '月卡');
    assert.equal(timeCard.type, 'time');
    assert.equal(timeCard.durationMs, 30 * DAY_MS);
    assert.equal(timeCard.enabled, true);
    assert.equal(timeCard.usedBy, '');

    const quotaCard = normalizeCard({ type: 'quota', value: 3, description: '额度' });
    assert.equal(quotaCard.type, 'quota');
    assert.equal(quotaCard.value, 3);
    assert.equal(quotaCard.days, 3);
    assert.equal(quotaCard.durationMs, null);
});

test('normalizeCard strips hyphens from codes', () => {
    const card = normalizeCard({ code: 'abcd-efgh-jkmn-pqrs', type: 'time', durationValue: 1 });
    assert.equal(card.code, 'ABCDEFGHJKMNPQRS');
});

test('computeNextExpiresAt extends from remaining validity or now', () => {
    const duration = normalizeTimeDuration({ durationValue: 10, durationUnit: 'day' });

    const fromNow = computeNextExpiresAt(undefined, duration, NOW);
    assert.equal(fromNow, NOW + 10 * DAY_MS);

    const fromFuture = computeNextExpiresAt(NOW + 5 * DAY_MS, duration, NOW);
    assert.equal(fromFuture, NOW + 15 * DAY_MS);

    const fromExpired = computeNextExpiresAt(NOW - 5 * DAY_MS, duration, NOW);
    assert.equal(fromExpired, NOW + 10 * DAY_MS);
});

test('computeNextExpiresAt honors permanent cards and permanent accounts', () => {
    const duration = normalizeTimeDuration({ durationValue: 10, durationUnit: 'day' });
    assert.equal(computeNextExpiresAt(undefined, { ...duration, isPermanent: true, durationMs: null }, NOW), null);
    assert.equal(computeNextExpiresAt(null, duration, NOW), null);
});

test('getQuotaValue falls back to at least one', () => {
    assert.equal(getQuotaValue({ value: 5, days: 1 }), 5);
    assert.equal(getQuotaValue({ value: null, days: 4 }), 4);
    assert.equal(getQuotaValue({ value: 0, days: 0 }), 1);
});

test('validateCardForUse rejects missing, disabled and used cards', () => {
    assert.equal(validateCardForUse(null), '卡密不存在');
    assert.equal(validateCardForUse({ enabled: false, usedBy: '' }), '卡密已被禁用');
    assert.equal(validateCardForUse({ enabled: true, usedBy: 'acc-1' }), '卡密已被使用');
    assert.equal(validateCardForUse({ enabled: true, usedBy: '' }), null);
});
