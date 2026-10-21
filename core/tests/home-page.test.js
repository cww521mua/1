const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const { getHomePage, setHomePage, DEFAULT_HOME_PAGE } = require('../dist/models/store/home-page');
const { getDataFile } = require('../dist/config/runtime-paths');

const HOME_FILE = getDataFile('home-page.json');

// 直接读写真实配置文件（core/data/home-page.json），测试前后备份还原
let backupContent = null;
let hadFile = false;

test.before(() => {
    if (fs.existsSync(HOME_FILE)) {
        hadFile = true;
        backupContent = fs.readFileSync(HOME_FILE);
    }
});

test.beforeEach(() => {
    // 每个用例从干净状态开始，避免互相污染
    fs.rmSync(HOME_FILE, { force: true });
});

test.after(() => {
    if (hadFile && backupContent !== null) {
        fs.writeFileSync(HOME_FILE, backupContent);
    } else if (!hadFile && fs.existsSync(HOME_FILE)) {
        fs.unlinkSync(HOME_FILE);
    }
});

test('默认主页配置结构完整', () => {
    const cfg = getHomePage();
    // brandName 留空表示跟随品牌设置的主标题（前端回退），默认为空
    assert.equal(cfg.brandName, '');
    assert.ok(cfg.hero.kicker);
    assert.ok(cfg.hero.title1);
    assert.ok(cfg.hero.title2);
    assert.ok(cfg.hero.description);
    assert.ok(Array.isArray(cfg.hero.chips) && cfg.hero.chips.length > 0);
    assert.ok(Array.isArray(cfg.features) && cfg.features.length === 8);
    for (const feat of cfg.features) {
        assert.ok(feat.icon);
        assert.ok(feat.title);
        assert.ok(feat.desc);
    }
    assert.ok(Array.isArray(cfg.steps) && cfg.steps.length === 3);
    assert.ok(cfg.cta.title);
    assert.ok(cfg.footerNote);
});

test('normalize 回退默认值：非法输入不产生空配置', () => {
    setHomePage({
        brandName: '   ',
        hero: { kicker: '', title1: '', title2: '', description: '' },
        features: [{ title: '', desc: '' }, 'bad', null],
        steps: [],
        cta: {},
        footerNote: '',
    });
    const cfg = getHomePage();
    assert.equal(cfg.brandName, '');
    assert.equal(cfg.hero.kicker, DEFAULT_HOME_PAGE.hero.kicker);
    assert.equal(cfg.hero.title1, DEFAULT_HOME_PAGE.hero.title1);
    assert.equal(cfg.hero.title2, DEFAULT_HOME_PAGE.hero.title2);
    assert.deepEqual(cfg.features, DEFAULT_HOME_PAGE.features);
    assert.deepEqual(cfg.steps, DEFAULT_HOME_PAGE.steps);
    assert.equal(cfg.cta.title, DEFAULT_HOME_PAGE.cta.title);
    assert.equal(cfg.footerNote, DEFAULT_HOME_PAGE.footerNote);
});

test('setHomePage 合并保存：部分更新不影响其他字段', () => {
    setHomePage({ hero: { ...DEFAULT_HOME_PAGE.hero, title1: '新标题第一行', chips: ['标签A', '标签B', '', '标签C'] } });
    let cfg = getHomePage();
    assert.equal(cfg.hero.title1, '新标题第一行');
    assert.equal(cfg.hero.title2, DEFAULT_HOME_PAGE.hero.title2);
    assert.deepEqual(cfg.hero.chips, ['标签A', '标签B', '标签C']);
    assert.deepEqual(cfg.features, DEFAULT_HOME_PAGE.features);

    setHomePage({ features: [
        { icon: 'bolt', title: '等级加速', desc: '一键加速' },
        { icon: 'unknown-icon-x', title: '未知图标卡', desc: '描述' },
    ] });
    cfg = getHomePage();
    assert.equal(cfg.features.length, 2);
    assert.equal(cfg.features[0].icon, 'bolt');
    assert.equal(cfg.features[1].icon, 'unknown-icon-x'); // 未知 key 保留，前端渲染回退默认图标
});

test('features/steps/chips 容量限制与非法条目过滤', () => {
    const manyFeatures = [];
    for (let i = 0; i < 20; i++) {
        manyFeatures.push({ icon: 'star', title: `卡${i}`, desc: '描述' });
    }
    manyFeatures.push({ icon: 'star', title: '无描述', desc: '' });
    const manySteps = [];
    for (let i = 0; i < 10; i++) {
        manySteps.push({ title: `步${i}`, desc: '描述' });
    }
    setHomePage({ features: manyFeatures, steps: manySteps, hero: { chips: Array.from({ length: 15 }, (_, i) => `标签${i}`) } });
    const cfg = getHomePage();
    assert.equal(cfg.features.length, 12);
    assert.equal(cfg.steps.length, 4);
    assert.equal(cfg.hero.chips.length, 8);
});
