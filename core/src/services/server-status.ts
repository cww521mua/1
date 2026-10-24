import type { CpuSample } from './server-status-types';
export {};

/**
 * 服务器状态采集：进程/系统资源与业务概览，供管理员设置页「服务器状态」展示。
 * CPU 使用率通过相邻两次采样差值计算，首次采样返回 null（前端显示为采样中）。
 */

const os = require('node:os');
const { version } = require('../../package.json');
const userStore = require('../models/user-store');

// 保留最近一次 CPU 时间采样
let lastCpuSample: CpuSample | null = null;

function sampleCpu(): CpuSample {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        const t = cpu.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, total, at: Date.now() };
}

/** 纯函数：由两次采样差值计算 CPU 使用率（0-100，无法计算时返回 null）。 */
function cpuPercentFrom(prev: CpuSample, now: CpuSample): number | null {
    const totalDelta = now.total - prev.total;
    if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
    const idleDelta = now.idle - prev.idle;
    if (!Number.isFinite(idleDelta)) return null;
    const percent = (1 - idleDelta / totalDelta) * 100;
    if (!Number.isFinite(percent)) return null;
    return Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
}

/** 差值采样：与上次请求间隔计算使用率；首次仅记录基线。 */
function takeCpuPercent(): number | null {
    const now = sampleCpu();
    if (!lastCpuSample) {
        lastCpuSample = now;
        return null;
    }
    const percent = cpuPercentFrom(lastCpuSample, now);
    lastCpuSample = now;
    return percent;
}

function formatLoadavg(): number[] {
    const loadavg = os.loadavg();
    return loadavg.map(value => Math.round(value * 100) / 100);
}

function collectServerStatus(provider: any): Record<string, any> {
    const cpus = os.cpus();
    const cpuPercent = takeCpuPercent();

    const mem = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();
    const systemUsed = Math.max(systemTotal - systemFree, 0);

    let accountList: any[] = [];
    try {
        const accountData = (provider && typeof provider.getAccounts === 'function')
            ? provider.getAccounts()
            : { accounts: [] };
        accountList = Array.isArray(accountData?.accounts) ? accountData.accounts : [];
    } catch {
        accountList = [];
    }

    let userCount = 0;
    try {
        const users = userStore.getAllUsers();
        userCount = Array.isArray(users) ? users.length : 0;
    } catch {
        userCount = 0;
    }

    return {
        version,
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        hostname: os.hostname(),
        processUptimeMs: Math.round(process.uptime() * 1000),
        systemUptimeSec: Math.round(os.uptime()),
        startedAt: Date.now() - Math.round(process.uptime() * 1000),
        cpu: {
            percent: cpuPercent,
            cores: cpus.length,
            model: cpus[0]?.model?.trim() || '',
            loadavg: formatLoadavg(),
        },
        memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            systemTotal,
            systemUsed,
            systemUsedPercent: systemTotal > 0 ? Math.round((systemUsed / systemTotal) * 1000) / 10 : 0,
        },
        accounts: {
            total: accountList.length,
            running: accountList.filter((account: any) => account?.running === true).length,
        },
        users: userCount,
        time: Date.now(),
    };
}

/** 测试用：重置采样基线。 */
function resetCpuSample(): void {
    lastCpuSample = null;
}

module.exports = {
    collectServerStatus,
    cpuPercentFrom,
    resetCpuSample,
};
