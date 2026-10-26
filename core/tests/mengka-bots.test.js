const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBotViews } = require('../dist/services/mengka-bots');

const BOTS = [
    { selfId: '111', nickname: '在线号', online: true, status: 1, statusText: '登录成功', lastActiveMs: 3000, protocolId: 1, platform: 'android', clientType: 'android' },
    { selfId: '222', nickname: '离线号', online: false, status: 0, statusText: '服务端通知账号离线', lastActiveMs: 5000, protocolId: 1, platform: 'android', clientType: 'android' },
    { selfId: '333', nickname: '未绑定号', online: false, status: 0, statusText: '登录等待超时', lastActiveMs: 1000, protocolId: 0, platform: 'android', clientType: 'android' },
];

const BINDINGS = [
    { selfId: '111', owner: 'alice', nickname: '在线号' },
    { selfId: '222', owner: 'bob', nickname: '离线号' },
];

test('buildBotViews：管理员可见全部账号并合并归属', () => {
    const views = buildBotViews(BOTS, BINDINGS, { isAdmin: true, username: 'admin' });
    assert.equal(views.length, 3);
    const byId = new Map(views.map(v => [v.selfId, v]));
    assert.equal(byId.get('111').ownerId, 'alice');
    assert.equal(byId.get('222').ownerId, 'bob');
    assert.equal(byId.get('333').ownerId, null);
    assert.equal(byId.get('333').bound, false);
    assert.ok(views.every(v => v.canManage), '管理员可管理全部账号');
});

test('buildBotViews：普通用户仅可见自己绑定的账号', () => {
    const alice = buildBotViews(BOTS, BINDINGS, { isAdmin: false, username: 'alice' });
    assert.deepEqual(alice.map(v => v.selfId), ['111']);
    assert.equal(alice[0].canManage, true);

    const bob = buildBotViews(BOTS, BINDINGS, { isAdmin: false, username: 'bob' });
    assert.deepEqual(bob.map(v => v.selfId), ['222']);
});

test('buildBotViews：在线标记与状态描述透传', () => {
    const views = buildBotViews(BOTS, BINDINGS, { isAdmin: true, username: 'admin' });
    const byId = new Map(views.map(v => [v.selfId, v]));
    assert.equal(byId.get('111').online, true);
    assert.equal(byId.get('222').online, false);
    assert.equal(byId.get('111').statusText, '登录成功');
    assert.equal(byId.get('222').statusText, '服务端通知账号离线');
});

test('buildBotViews：在线优先，其后按最后活跃倒序', () => {
    const views = buildBotViews(BOTS, BINDINGS, { isAdmin: true, username: 'admin' });
    assert.deepEqual(views.map(v => v.selfId), ['111', '222', '333']);
});

test('buildBotViews：秒级时间戳转毫秒，非法值归零', () => {
    const views = buildBotViews(
        [{ selfId: '444', last_active: 1793000000, status: 0 }, { selfId: '555', last_active: '', status: 0 }],
        [],
        { isAdmin: true, username: 'admin' },
    );
    const byId = new Map(views.map(v => [v.selfId, v]));
    assert.equal(byId.get('444').lastActiveMs, 1793000000 * 1000);
    assert.equal(byId.get('555').lastActiveMs, 0);
});

test('buildBotViews：空输入与脏数据安全兜底', () => {
    assert.deepEqual(buildBotViews([], [], { isAdmin: true, username: 'admin' }), []);
    assert.deepEqual(buildBotViews(null, null, { isAdmin: true, username: 'admin' }), []);
    // 缺 selfId 的脏数据被过滤
    const views = buildBotViews([{ nickname: 'no-id' }, { selfId: '666', status: 0 }], null, { isAdmin: true, username: 'admin' });
    assert.deepEqual(views.map(v => v.selfId), ['666']);
});
