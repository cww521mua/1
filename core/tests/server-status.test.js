const test = require('node:test');
const assert = require('node:assert/strict');

const { collectServerStatus, cpuPercentFrom, resetCpuSample } = require('../dist/services/server-status');

const providerStub = {
    getAccounts: () => ({
        accounts: [
            { id: 'a1', running: true },
            { id: 'a2', running: false },
            { id: 'a3', running: true },
        ],
    }),
};

test('cpuPercentFrom：空闲差值 0%、半空闲 50%、无差值返回 null、异常输入返回 null', () => {
    // 全程满负荷（idle 无增长）→ 100% 负载
    assert.equal(cpuPercentFrom({ idle: 0, total: 100, at: 0 }, { idle: 0, total: 200, at: 10 }), 100);
    // 一半 idle → 50%
    assert.equal(cpuPercentFrom({ idle: 0, total: 100, at: 0 }, { idle: 50, total: 200, at: 10 }), 50);
    // 全程 idle → 0%
    assert.equal(cpuPercentFrom({ idle: 100, total: 100, at: 0 }, { idle: 200, total: 200, at: 10 }), 0);
    // total 无增长 → 无法计算
    assert.equal(cpuPercentFrom({ idle: 0, total: 100, at: 0 }, { idle: 0, total: 100, at: 10 }), null);
    // 异常输入
    assert.equal(cpuPercentFrom({ idle: NaN, total: 100, at: 0 }, { idle: 0, total: 200, at: 10 }), null);
    // 结果夹在 0-100 之间
    assert.equal(cpuPercentFrom({ idle: 999, total: 100, at: 0 }, { idle: 0, total: 200, at: 10 }), 100);
});

test('collectServerStatus：字段完整、类型正确、业务概览来自 provider', () => {
    const status = collectServerStatus(providerStub);

    assert.equal(typeof status.version, 'string');
    assert.ok(status.version.length > 0);
    assert.ok(status.nodeVersion.startsWith('v'));
    assert.equal(typeof status.platform, 'string');
    assert.ok(status.platform.length > 0);
    assert.equal(typeof status.hostname, 'string');

    assert.ok(status.processUptimeMs >= 0);
    assert.ok(status.systemUptimeSec >= 0);
    assert.ok(status.startedAt <= Date.now());

    assert.ok(status.cpu.cores >= 1);
    assert.ok(status.cpu.percent === null || (status.cpu.percent >= 0 && status.cpu.percent <= 100));
    assert.ok(Array.isArray(status.cpu.loadavg));

    assert.ok(status.memory.rss > 0);
    assert.ok(status.memory.systemTotal > 0);
    assert.ok(status.memory.systemUsed >= 0 && status.memory.systemUsed <= status.memory.systemTotal);
    assert.ok(status.memory.systemUsedPercent >= 0 && status.memory.systemUsedPercent <= 100);

    assert.deepEqual(status.accounts, { total: 3, running: 2 });
    assert.equal(typeof status.users, 'number');
    assert.ok(status.users >= 0);
    assert.ok(Math.abs(status.time - Date.now()) < 5000);
});

test('collectServerStatus：provider 缺失或异常时安全兜底', () => {
    for (const provider of [null, undefined, {}, { getAccounts: () => null }, { getAccounts: () => { throw new Error('boom'); } }]) {
        const status = collectServerStatus(provider);
        assert.deepEqual(status.accounts, { total: 0, running: 0 });
    }
});

test('collectServerStatus：连续采样后 cpu.percent 变为数值', () => {
    resetCpuSample();
    const first = collectServerStatus(providerStub);
    assert.equal(first.cpu.percent, null);
    const busyStart = Date.now();
    while (Date.now() - busyStart < 15) { /* 制造时间差保证采样增量 > 0 */ }
    const second = collectServerStatus(providerStub);
    assert.ok(second.cpu.percent !== null, '第二次采样应产出 CPU 使用率');
    assert.ok(second.cpu.percent >= 0 && second.cpu.percent <= 100);
    resetCpuSample();
});
