const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeBot } = require('../dist/services/mengka-connector');

test('normalizeBot 归一化在线安卓账号并透传时间字段', () => {
    const bot = normalizeBot({
        self_id: 3327354736,
        nickname: '听风想你',
        platform: 'android',
        client_type: 'android',
        status: 1,
        last_active: 1792492494,
        login_time: 1792491953,
    });
    assert.equal(bot.selfId, '3327354736');
    assert.equal(bot.nickname, '听风想你');
    assert.equal(bot.clientType, 'android');
    assert.equal(bot.online, true);
    assert.equal(bot.status, 1);
    assert.equal(bot.lastActive, 1792492494);
    assert.equal(bot.loginTime, 1792491953);
});

test('normalizeBot 覆盖离线与登录中状态', () => {
    assert.equal(normalizeBot({ self_id: 1, status: 0 }).status, 0);
    assert.equal(normalizeBot({ self_id: 1, status: 0 }).online, false);
    assert.equal(normalizeBot({ self_id: 1, status: 2 }).status, 2);
    // status 2 为登录中，不算在线
    assert.equal(normalizeBot({ self_id: 1, status: 2 }).online, false);
});

test('normalizeBot 的 online 布尔字段优先于 status', () => {
    assert.equal(normalizeBot({ self_id: 1, status: 0, online: true }).online, true);
    assert.equal(normalizeBot({ self_id: 1, status: 1, online: false }).online, false);
});

test('normalizeBot 缺省 status 视为离线并容错缺字段', () => {
    const bot = normalizeBot({ self_id: 123 });
    assert.equal(bot.status, 0);
    assert.equal(bot.online, false);
    assert.equal(bot.nickname, '');
    assert.equal(bot.lastActive, '');
    assert.equal(bot.loginTime, '');
});

test('normalizeBot 识别 linuxqq 协议', () => {
    assert.equal(normalizeBot({ self_id: 1, platform: 'linux', client_type: 'linuxqq' }).clientType, 'linuxqq');
    assert.equal(normalizeBot({ self_id: 1, platform: 'android' }).clientType, 'android');
});

test('normalizeBot 兼容驼峰 selfId 输入', () => {
    assert.equal(normalizeBot({ selfId: 42 }).selfId, '42');
});
