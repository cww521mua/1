const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const { getDataFile } = require('../dist/config/runtime-paths');
const store = require('../dist/models/store');
const cardStore = require('../dist/models/card-store');
const userStore = require('../dist/models/user-store');

const { HOUR_MS } = cardStore;

const BACKUP_FILES = ['store.json', 'users.json', 'cards.json', 'trial-ips.json']
    .map(name => ({ name, path: getDataFile(name) }));

// 整体备份还原，避免污染真实数据
let backups = [];

test.before(() => {
    backups = BACKUP_FILES.map((file) => {
        if (fs.existsSync(file.path)) {
            return { ...file, had: true, content: fs.readFileSync(file.path) };
        }
        return { ...file, had: false, content: null };
    });
});

test.after(() => {
    for (const backup of backups) {
        if (backup.had) {
            fs.writeFileSync(backup.path, backup.content);
        }
        else if (fs.existsSync(backup.path)) {
            fs.unlinkSync(backup.path);
        }
    }
});

test.beforeEach(() => {
    // 每个用例前清空用户/卡密/试用 IP 记录，卡密设置回默认（试用开关关闭）
    for (const name of ['users.json', 'cards.json', 'trial-ips.json']) {
        const file = getDataFile(name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    store.setCardSettings({ enabled: false, trialEnabled: false, accountLimit: 0 });
});

function createTrialCard(description = '试用卡') {
    return cardStore.createCard(description, { purpose: 'trial' });
}

test('createCard(purpose=trial) 强制生成 1 小时时间卡并保留试用标记', () => {
    // 即使传入 quota/永久/30 天参数，也会被强制覆盖
    const card = cardStore.createCard('试用卡', {
        purpose: 'trial',
        type: 'quota',
        value: 3,
        durationValue: 30,
        durationUnit: 'day',
        isPermanent: true,
    });

    assert.equal(card.type, 'time');
    assert.equal(card.purpose, 'trial');
    assert.equal(card.durationValue, 1);
    assert.equal(card.durationUnit, 'hour');
    assert.equal(card.durationMs, HOUR_MS);
    assert.equal(card.isPermanent, false);
    assert.equal(card.enabled, true);
});

test('normalizeCard 保留 trial 标记，validateCardForUse 拒绝试用卡', () => {
    const normalized = cardStore.normalizeCard({
        code: 'abcd-efgh-jkmn-pqrs',
        type: 'time',
        durationValue: 1,
        durationUnit: 'hour',
        purpose: 'trial',
    });
    assert.equal(normalized.code, 'ABCDEFGHJKMNPQRS');
    assert.equal(normalized.purpose, 'trial');

    const error = cardStore.validateCardForUse({ enabled: true, usedBy: '', purpose: 'trial' });
    assert.equal(error, '试用卡密仅限注册页领取，不能在此使用');

    // 普通时间卡不受影响
    assert.equal(cardStore.validateCardForUse({ enabled: true, usedBy: '' }), null);
});

test('getTrialStatus/findTrialCard：开关与剩余名额联动，取尽返回 null', () => {
    // 默认关闭
    assert.deepEqual(cardStore.getTrialStatus(), { enabled: false, remaining: 0 });
    assert.equal(cardStore.findTrialCard(), null);

    store.setCardSettings({ trialEnabled: true });
    assert.deepEqual(cardStore.getTrialStatus(), { enabled: true, remaining: 0 });

    const first = createTrialCard('试用卡1');
    const second = createTrialCard('试用卡2');
    assert.deepEqual(cardStore.getTrialStatus(), { enabled: true, remaining: 2 });

    // 普通时间卡与禁用的试用卡不计入名额
    cardStore.createCard('普通时间卡', { type: 'time', durationValue: 30, durationUnit: 'day' });
    const disabledTrial = createTrialCard('禁用试用卡');
    cardStore.updateCard(disabledTrial.code, { enabled: false });
    assert.equal(cardStore.countAvailableTrialCards(), 2);

    // 按创建时间最早的先发
    assert.equal(cardStore.findTrialCard().code, first.code);

    // 用掉最早的一张后剩余 1，下一张是 second
    cardStore.markCardUsed(first, 'usera', 'usera', Date.now());
    assert.deepEqual(cardStore.getTrialStatus(), { enabled: true, remaining: 1 });
    assert.equal(cardStore.findTrialCard().code, second.code);

    cardStore.markCardUsed(second, 'userb', 'userb', Date.now());
    assert.deepEqual(cardStore.getTrialStatus(), { enabled: true, remaining: 0 });
    assert.equal(cardStore.findTrialCard(), null);
});

test('试用卡不能用于普通注册与续费（validateCardForUse 拦截）', () => {
    store.setCardSettings({ trialEnabled: true });
    const card = createTrialCard();

    const registered = userStore.registerUser('normaluser', 'Passw0rd', card.code);
    assert.equal(registered.ok, false);
    assert.equal(registered.error, '试用卡密仅限注册页领取，不能在此使用');

    // 领试用成功后再试续费同样被拦截
    const trial = userStore.registerTrialUser('trialuser', 'Passw0rd', '3.3.3.3');
    assert.equal(trial.ok, true);
    const renewed = userStore.renewUser('trialuser', card.code);
    assert.equal(renewed.ok, false);
    assert.equal(renewed.error, '试用卡密仅限注册页领取，不能在此使用');
});

test('registerTrialUser：开关关闭拒绝、无卡拒绝、成功开通 1 小时并记录 IP', () => {
    // 开关开启但卡池为空：名额已领完
    store.setCardSettings({ trialEnabled: true });
    assert.equal(userStore.registerTrialUser('usera', 'Passw0rd', '1.1.1.1').error, '试用名额已领完，请联系管理员');

    // 开关关闭：即使卡池有卡也直接拒绝
    createTrialCard();
    store.setCardSettings({ trialEnabled: false });
    assert.equal(userStore.registerTrialUser('userb', 'Passw0rd', '1.1.1.1').error, '试用领取未开放');

    // 重新开启：成功领取，有效期 = 当前时间 + 1 小时，卡被标记使用，IP 记录落盘
    store.setCardSettings({ trialEnabled: true });
    const card = cardStore.findTrialCard();
    assert.ok(card, '卡池应有一张可用试用卡');
    const before = Date.now();
    const result = userStore.registerTrialUser('usera', 'Passw0rd', '1.1.1.1');
    assert.equal(result.ok, true);

    const user = userStore.findUser('usera');
    assert.ok(user);
    assert.equal(user.card.code, card.code);
    assert.equal(user.card.isPermanent, false);
    assert.ok(Math.abs(user.card.expiresAt - (before + HOUR_MS)) < 5000, '有效期应约为当前时间 + 1 小时');

    assert.equal(cardStore.getTrialStatus().remaining, 0);
    const ips = JSON.parse(fs.readFileSync(getDataFile('trial-ips.json'), 'utf8'));
    assert.equal(ips['1.1.1.1'].username, 'usera');
});

test('registerTrialUser：同一 IP 仅限领取一次', () => {
    store.setCardSettings({ trialEnabled: true });
    createTrialCard('试用卡1');
    createTrialCard('试用卡2');

    assert.equal(userStore.registerTrialUser('usera', 'Passw0rd', '2.2.2.2').ok, true);
    // 卡池仍有 1 张，但同一 IP 已领过
    assert.equal(cardStore.getTrialStatus().remaining, 1);
    const second = userStore.registerTrialUser('userb', 'Passw0rd', '2.2.2.2');
    assert.equal(second.ok, false);
    assert.equal(second.error, '该网络已领取过试用，请直接登录或使用卡密注册');

    // 其他 IP 可正常领取第二张
    assert.equal(userStore.registerTrialUser('userb', 'Passw0rd', '4.4.4.4').ok, true);
    assert.equal(cardStore.getTrialStatus().remaining, 0);
});
