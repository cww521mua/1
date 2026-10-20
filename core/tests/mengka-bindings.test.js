const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { getDataFile } = require('../dist/config/runtime-paths');
const bindings = require('../dist/models/store/mengka-bindings');

// 测试直接操作真实 data 目录的绑定文件：先备份已有文件，结束后还原，
// 保证不丢失开发环境的真实绑定数据。
const FILE = getDataFile('mengka-bindings.json');
const BACKUP = `${FILE}.test-bak`;
let hasBackup = false;

function removeBindingsFile() {
    try { fs.rmSync(FILE); } catch { /* 文件不存在 */ }
}

test.before(() => {
    if (fs.existsSync(FILE)) {
        fs.copyFileSync(FILE, BACKUP);
        hasBackup = true;
        removeBindingsFile();
    }
});

test.after(() => {
    removeBindingsFile();
    if (hasBackup) {
        fs.copyFileSync(BACKUP, FILE);
        fs.rmSync(BACKUP);
    }
});

test('upsert 新增与更新绑定，selfId 唯一', () => {
    bindings.upsertMengkaBinding('3327354736', 'alice', '听风想你');
    bindings.upsertMengkaBinding('1234567890', 'bob', '');
    let all = bindings.getMengkaBindings();
    assert.equal(all.length, 2);
    assert.equal(bindings.findMengkaBinding('3327354736').owner, 'alice');
    assert.equal(bindings.findMengkaBinding('3327354736').nickname, '听风想你');

    bindings.upsertMengkaBinding('3327354736', 'alice2', '新昵称');
    all = bindings.getMengkaBindings();
    assert.equal(all.length, 2);
    const updated = bindings.findMengkaBinding('3327354736');
    assert.equal(updated.owner, 'alice2');
    assert.equal(updated.nickname, '新昵称');
    assert.ok(updated.boundAt > 0);
});

test('findMengkaBindingsByOwner 仅返回本人绑定', () => {
    assert.deepEqual(bindings.findMengkaBindingsByOwner('alice2').map(item => item.selfId), ['3327354736']);
    assert.deepEqual(bindings.findMengkaBindingsByOwner('bob').map(item => item.selfId), ['1234567890']);
    assert.deepEqual(bindings.findMengkaBindingsByOwner('nobody'), []);
    assert.deepEqual(bindings.findMengkaBindingsByOwner(''), []);
});

test('deleteMengkaBinding 解绑后可重新绑定给他人', () => {
    bindings.deleteMengkaBinding('3327354736');
    assert.equal(bindings.findMengkaBinding('3327354736'), null);
    bindings.upsertMengkaBinding('3327354736', 'carol', '');
    assert.equal(bindings.findMengkaBinding('3327354736').owner, 'carol');
    bindings.deleteMengkaBinding('1234567890');
    assert.equal(bindings.findMengkaBinding('1234567890'), null);
});

test('normalize 过滤非法 selfId 与空 owner', () => {
    bindings.upsertMengkaBinding('abc123', 'x', '');
    bindings.upsertMengkaBinding('123', 'y', '');
    bindings.upsertMengkaBinding('987654321', '  ', '');
    const all = bindings.getMengkaBindings();
    assert.equal(all.some(item => item.selfId === 'abc123'), false);
    assert.equal(all.some(item => item.selfId === '123'), false);
    assert.equal(all.some(item => item.selfId === '987654321'), false);
    assert.equal(all.some(item => item.selfId === '3327354736'), true);
});

test('findMengkaBinding 对空输入安全', () => {
    assert.equal(bindings.findMengkaBinding(''), null);
    assert.equal(bindings.findMengkaBinding(null), null);
    assert.deepEqual(bindings.findMengkaBindingsByOwner(null), []);
});
