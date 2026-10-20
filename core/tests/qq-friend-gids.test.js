const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeQqFriendGidKey,
    normalizeQqFriendGidArchiveData,
    findQqFriendGidArchive,
    saveQqFriendGidArchive,
} = require('../dist/models/store/qq-friend-gids');

const { getDataFile } = require('../dist/config/runtime-paths');
const ARCHIVE_FILE = getDataFile('qq-friend-gids.json');

// 直接读写真实档案文件（core/data/qq-friend-gids.json），测试前后备份还原
let backupContent = null;
let hadFile = false;

test.before(() => {
    if (fs.existsSync(ARCHIVE_FILE)) {
        hadFile = true;
        backupContent = fs.readFileSync(ARCHIVE_FILE);
    }
});

test.after(() => {
    if (hadFile && backupContent !== null) {
        fs.writeFileSync(ARCHIVE_FILE, backupContent);
    } else if (!hadFile && fs.existsSync(ARCHIVE_FILE)) {
        fs.unlinkSync(ARCHIVE_FILE);
    }
});

test('normalizeQqFriendGidKey 仅保留合法的十进制 gid 字符串', () => {
    assert.equal(normalizeQqFriendGidKey(' 660123 '), '660123');
    assert.equal(normalizeQqFriendGidKey(123456), '123456');
    assert.equal(normalizeQqFriendGidKey('abc'), '');
    assert.equal(normalizeQqFriendGidKey('12x45'), '');
    assert.equal(normalizeQqFriendGidKey(''), '');
    assert.equal(normalizeQqFriendGidKey(null), '');
    assert.equal(normalizeQqFriendGidKey(undefined), '');
});

test('normalizeQqFriendGidArchiveData 过滤非法条目并按更新时间排序', () => {
    const data = normalizeQqFriendGidArchiveData({
        entries: [
            { gid: '111', gids: [1, '2', 2, -3, 0, 'x'], updatedAt: 100 },
            { gid: '222', gids: [] },
            { gid: 'bad', gids: [9] },
            { gid: '111', gids: [5], updatedAt: 200 },
            null,
        ],
    });
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].gid, '111');
    assert.deepEqual(data.entries[0].gids, [1, 2]);
});

test('normalizeQqFriendGidArchiveData 超容量时保留最近更新的档案', () => {
    const entries = [];
    for (let i = 0; i < 502; i++) {
        entries.push({ gid: String(i + 1), gids: [i + 1], updatedAt: i + 1 });
    }
    const data = normalizeQqFriendGidArchiveData({ entries });
    assert.equal(data.entries.length, 500);
    assert.equal(data.entries[0].gid, '502');
    assert.ok(!data.entries.some(item => item.gid === '1'));
});

test('saveQqFriendGidArchive 合并写入，find 按 gid 读取；非法输入不落盘', () => {
    const merged = saveQqFriendGidArchive('900111', [1, 2, 3]);
    assert.deepEqual(merged, [1, 2, 3]);
    const merged2 = saveQqFriendGidArchive('900111', [3, 4, 5]);
    assert.deepEqual(merged2, [1, 2, 3, 4, 5]);
    assert.deepEqual(findQqFriendGidArchive('900111').gids, [1, 2, 3, 4, 5]);

    saveQqFriendGidArchive('900222', [7]);
    assert.deepEqual(findQqFriendGidArchive('900222').gids, [7]);
    assert.equal(findQqFriendGidArchive('900333'), null);
    assert.equal(findQqFriendGidArchive('bad-key'), null);

    assert.deepEqual(saveQqFriendGidArchive('', [1, 2]), []);
    assert.deepEqual(saveQqFriendGidArchive('900444', 'oops'), []);
    assert.deepEqual(saveQqFriendGidArchive('900444', []), []);
    assert.equal(findQqFriendGidArchive('900444'), null);
    assert.ok(fs.existsSync(path.dirname(ARCHIVE_FILE)));
});
