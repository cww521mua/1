export interface MengkaBinding { selfId: string, owner: string, nickname: string, boundAt: number }
interface MengkaBindingsData { bindings: MengkaBinding[] }
export {};

/**
 * 萌卡 QQ 与面板用户的绑定存储（core/data/mengka-bindings.json）。
 * 面板侧权威归属来源；萌卡侧租约（set_account_access owner_id）仅作备份。
 */
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const BINDINGS_FILE: string = getDataFile('mengka-bindings.json');

function normalizeBindingsData(raw: unknown): MengkaBindingsData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set<string>();
    const bindings: MengkaBinding[] = [];
    for (const item of (Array.isArray(data.bindings) ? data.bindings : [])) {
        const selfId = String(item?.selfId || '').trim();
        const owner = String(item?.owner || '').trim();
        if (!/^\d{5,12}$/.test(selfId) || !owner || seen.has(selfId)) continue;
        seen.add(selfId);
        bindings.push({
            selfId,
            owner,
            nickname: String(item?.nickname || '').trim(),
            boundAt: Number(item?.boundAt) || Date.now(),
        });
    }
    return { bindings };
}

function loadBindings(): MengkaBindingsData {
    ensureDataDir();
    return normalizeBindingsData(readJsonFile(BINDINGS_FILE, () => ({ bindings: [] })));
}

function saveBindings(data: MengkaBindingsData): void {
    ensureDataDir();
    writeJsonFileAtomic(BINDINGS_FILE, normalizeBindingsData(data));
}

function getMengkaBindings(): MengkaBinding[] {
    return loadBindings().bindings;
}

function findMengkaBinding(selfId: unknown): MengkaBinding | null {
    const target = String(selfId || '').trim();
    return getMengkaBindings().find(item => item.selfId === target) || null;
}

function findMengkaBindingsByOwner(owner: unknown): MengkaBinding[] {
    const target = String(owner || '').trim();
    if (!target) return [];
    return getMengkaBindings().filter(item => item.owner === target);
}

function upsertMengkaBinding(selfId: unknown, owner: unknown, nickname: unknown): MengkaBinding {
    const data = loadBindings();
    const target = String(selfId || '').trim();
    const binding: MengkaBinding = {
        selfId: target,
        owner: String(owner || '').trim(),
        nickname: String(nickname || '').trim(),
        boundAt: Date.now(),
    };
    const idx = data.bindings.findIndex(item => item.selfId === target);
    if (idx >= 0) data.bindings[idx] = binding;
    else data.bindings.push(binding);
    saveBindings(data);
    return binding;
}

function deleteMengkaBinding(selfId: unknown): void {
    const target = String(selfId || '').trim();
    const data = loadBindings();
    const next = data.bindings.filter(item => item.selfId !== target);
    if (next.length === data.bindings.length) return;
    saveBindings({ bindings: next });
}

module.exports = {
    getMengkaBindings,
    findMengkaBinding,
    findMengkaBindingsByOwner,
    upsertMengkaBinding,
    deleteMengkaBinding,
};
