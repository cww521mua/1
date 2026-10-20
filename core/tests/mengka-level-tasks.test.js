const assert = require('node:assert/strict');
const test = require('node:test');

const {
    normalizeLevelAccounts,
    filterLevelAccountsForOwner,
    tenthsToDays,
} = require('../dist/services/mengka-level-tasks');

test('normalizeLevelAccounts 仅保留 android 平台且 selfId 合法的账号', () => {
    const list = normalizeLevelAccounts([
        { selfId: 3327354736, platform: 'android', nickname: '听风想你', status: 1, level: 62, levelTaskSupported: true },
        { self_id: '43164569', platform: 'android', nickname: '', status: 0, level: 8 },
        { selfId: 1, platform: 'linux', nickname: 'x', status: 1, level: 10 },
        { selfId: 'abc', platform: 'android', nickname: 'bad', status: 1, level: 5 },
        { selfId: '12345', platform: 'android', nickname: 'min-ok', status: 2, level: 3 },
        null,
        'junk',
    ]);
    assert.equal(list.length, 3);
    assert.deepEqual(list[0], { selfId: '3327354736', nickname: '听风想你', status: 1, level: 62, levelTaskSupported: true });
    assert.equal(list[1].selfId, '43164569');
    assert.equal(list[1].levelTaskSupported, true);
    assert.equal(list[2].selfId, '12345');
    assert.equal(list[2].status, 2);
});

test('normalizeLevelAccounts 支持 { accounts } 包装与非数组输入', () => {
    const wrapped = normalizeLevelAccounts({
        accounts: [{ selfId: '3327354736', platform: 'android', nickname: 'a', status: 1, level: 1 }],
    });
    assert.equal(wrapped.length, 1);
    assert.equal(wrapped[0].selfId, '3327354736');
    assert.deepEqual(normalizeLevelAccounts(null), []);
    assert.deepEqual(normalizeLevelAccounts('oops'), []);
    assert.deepEqual(normalizeLevelAccounts({}), []);
});

test('normalizeLevelAccounts 非法等级归 0，levelTaskSupported 显式 false 保留', () => {
    const list = normalizeLevelAccounts([
        { selfId: '3327354736', platform: 'android', level: 'high', levelTaskSupported: false },
    ]);
    assert.equal(list[0].level, 0);
    assert.equal(list[0].levelTaskSupported, false);
});

test('filterLevelAccountsForOwner 管理员全量可见，普通用户仅限本人绑定', () => {
    const accounts = [
        { selfId: '3327354736', nickname: 'a' },
        { selfId: '43164569', nickname: 'b' },
        { selfId: '12345', nickname: 'c' },
    ];
    const ownerMap = new Map([
        ['3327354736', 'alice'],
        ['43164569', 'bob'],
        ['12345', null],
    ]);

    const adminView = filterLevelAccountsForOwner(accounts, ownerMap, true, 'alice');
    assert.equal(adminView.length, 3);

    const userView = filterLevelAccountsForOwner(accounts, ownerMap, false, 'alice');
    assert.equal(userView.length, 1);
    assert.equal(userView[0].selfId, '3327354736');

    // 未绑定（owner 为 null）的账号对普通用户不可见
    assert.equal(filterLevelAccountsForOwner(accounts, ownerMap, false, 'carol').length, 0);
});

test('tenthsToDays 十分之一天换算，非法输入返回 null', () => {
    assert.equal(tenthsToDays(15), 1.5);
    assert.equal(tenthsToDays('10'), 1);
    assert.equal(tenthsToDays(0), 0);
    assert.equal(tenthsToDays(-5), -0.5);
    assert.equal(tenthsToDays(null), null);
    assert.equal(tenthsToDays(undefined), null);
    assert.equal(tenthsToDays('abc'), null);
    assert.equal(tenthsToDays(7.2), 0.7);
});
