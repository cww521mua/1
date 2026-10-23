const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const { getDataFile } = require('../dist/config/runtime-paths');
const store = require('../dist/models/store');

const STORE_FILE = getDataFile('store.json');

// 登录设置存于 store.json 全局配置，测试前后整体备份还原
let backupContent = null;
let hadFile = false;

test.before(() => {
    if (fs.existsSync(STORE_FILE)) {
        hadFile = true;
        backupContent = fs.readFileSync(STORE_FILE);
    }
});

test.after(() => {
    if (hadFile && backupContent !== null) {
        fs.writeFileSync(STORE_FILE, backupContent);
    }
});

test('默认登录设置：五个标签按默认顺序、萌卡默认平板与文案', () => {
    const cfg = store.getLoginSettings();
    assert.deepEqual(cfg.tabs.map(t => t.key), ['code', 'wx_qr', 'qq_qr', 'mengka', 'capture']);
    assert.ok(cfg.tabs.every(t => t.enabled === true));
    assert.deepEqual(cfg.tabs.map(t => t.label), ['输入 Code 登录', '微信扫码登录', 'QQ扫码登录', '萌卡登录', '抓包登录']);
    assert.equal(cfg.mengkaDefaultProtocol, 'tablet');
    assert.equal(cfg.mengkaAddButtonLabel, '添加QQ号');
    assert.equal(cfg.mengkaProtocolNote, '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉');
    assert.ok(cfg.mengkaEntryHint.includes('列表里没有你的 QQ'));
});

test('tabs 归一化：未知 key 过滤、去重、空标题回退、缺失 key 补齐', () => {
    store.setLoginSettings({
        tabs: [
            { key: 'mengka', label: '', enabled: true },
            { key: 'code', label: '粘贴 Code', enabled: true },
            { key: 'code', label: '重复的会被去掉', enabled: true },
            { key: 'hacker', label: '未知标签', enabled: true },
            { key: 'capture', label: '抓包取码', enabled: false },
        ],
    });
    const cfg = store.getLoginSettings();
    assert.deepEqual(cfg.tabs.map(t => t.key), ['mengka', 'code', 'capture', 'wx_qr', 'qq_qr']);
    assert.equal(cfg.tabs.find(t => t.key === 'mengka').label, '萌卡登录');
    assert.equal(cfg.tabs.find(t => t.key === 'code').label, '粘贴 Code');
    assert.equal(cfg.tabs.find(t => t.key === 'capture').enabled, false);
    assert.equal(cfg.tabs.find(t => t.key === 'wx_qr').label, '微信扫码登录');
});

test('萌卡文案与默认协议：空值回退、非法协议回退平板', () => {
    store.setLoginSettings({
        mengkaDefaultProtocol: 'phone',
        mengkaAddButtonLabel: '  ',
        mengkaProtocolNote: '',
        mengkaEntryHint: '自定义提示语',
    });
    let cfg = store.getLoginSettings();
    assert.equal(cfg.mengkaDefaultProtocol, 'phone');
    assert.equal(cfg.mengkaAddButtonLabel, '添加QQ号');
    assert.equal(cfg.mengkaProtocolNote, '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉');
    assert.equal(cfg.mengkaEntryHint, '自定义提示语');

    store.setLoginSettings({ mengkaDefaultProtocol: 'invalid', mengkaEntryHint: '  ' });
    cfg = store.getLoginSettings();
    assert.equal(cfg.mengkaDefaultProtocol, 'tablet');
    assert.ok(cfg.mengkaEntryHint.includes('列表里没有你的 QQ'));
});

test('部分保存不丢失其他登录设置字段', () => {
    store.setLoginSettings({
        wechatQrLogin: false,
        napCatEndpoint: 'http://127.0.0.1:9700',
        napCatSignature: 'sig-abc',
        tabs: [{ key: 'code', label: 'Code 登录', enabled: true }],
        mengkaDefaultProtocol: 'tablet',
    });
    const cfg = store.getLoginSettings();
    assert.equal(cfg.wechatQrLogin, false);
    assert.equal(cfg.napCatEndpoint, 'http://127.0.0.1:9700');
    assert.equal(cfg.napCatSignature, 'sig-abc');
    assert.deepEqual(cfg.tabs.map(t => t.key), ['code', 'wx_qr', 'qq_qr', 'mengka', 'capture']);
});
