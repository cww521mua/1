<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { storeToRefs } from 'pinia'
import { useAccountStore } from '@/stores/account'
import {
  copyTextToClipboard,
  exportCardsToText,
  formatCardDate,
  formatCardValue,
  getCardTypeLabel,
  useCardStore,
  type CardRecord,
} from '@/stores/card'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const cardStore = useCardStore()
const accountStore = useAccountStore()
const { cards, overview, loading, newCardForm } = storeToRefs(cardStore)
const { accounts } = storeToRefs(accountStore)

// ==================== 管控设置 ====================
const settingsSaving = ref(false)
const localAccountLimit = ref(0)
const showEnableConfirm = ref(false)

const settingsSummary = computed(() => {
  const { settings, accountCount, availableTimeCards } = overview.value
  if (!settings.enabled) {
    return `当前未启用卡密管控，账号数量不受限制。可用时间卡密 ${availableTimeCards} 个。`
  }
  return `已启用卡密管控：账号 ${accountCount}/${settings.accountLimit}，新增超出上限的账号需核销额度卡密；可用时间卡密 ${availableTimeCards} 个。`
})

async function handleSaveSettings() {
  settingsSaving.value = true
  try {
    const result = await cardStore.saveCardSettings({ accountLimit: Number(localAccountLimit.value) || 0 })
    if (result.ok)
      toast.success('卡密设置已保存')
  }
  finally {
    settingsSaving.value = false
  }
}

function handleEnabledChange(value: boolean | undefined) {
  if (value === undefined)
    return
  if (value) {
    overview.value.settings.enabled = false
    showEnableConfirm.value = true
    return
  }
  void disableCardControl()
}

async function disableCardControl() {
  settingsSaving.value = true
  try {
    const result = await cardStore.saveCardSettings({ enabled: false })
    if (result.ok)
      toast.success('已关闭卡密管控，账号数量不再受限')
  }
  finally {
    settingsSaving.value = false
  }
}

async function confirmEnableCardControl() {
  settingsSaving.value = true
  try {
    const result = await cardStore.saveCardSettings({ enabled: true, accountLimit: Number(localAccountLimit.value) || 0 })
    if (result.ok)
      toast.success('已开启卡密管控，新增账号将受账号上限约束')
    showEnableConfirm.value = false
  }
  finally {
    settingsSaving.value = false
  }
}

// ==================== 创建卡密 ====================
const creating = ref(false)

const cardTypeOptions = [
  { label: '时间卡（账号续期）', value: 'time' },
  { label: '额度卡（提升账号上限）', value: 'quota' },
]

async function handleCreateCard() {
  creating.value = true
  try {
    const result = await cardStore.createCards(newCardForm.value)
    if (result.ok) {
      toast.success(result.batch ? `成功创建 ${result.count} 个卡密，已导出文本` : '卡密创建成功')
      cardStore.resetForm()
    }
    else if (result.error) {
      toast.warning(result.error)
    }
  }
  finally {
    creating.value = false
  }
}

// ==================== 列表筛选 ====================
const searchQuery = ref('')
const statusFilter = ref<'all' | 'used' | 'unused'>('all')
const typeFilter = ref<'all' | 'time' | 'quota'>('all')

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '未使用', value: 'unused' },
  { label: '已使用', value: 'used' },
]

const typeOptions = [
  { label: '全部类型', value: 'all' },
  { label: '时间卡', value: 'time' },
  { label: '额度卡', value: 'quota' },
]

const filteredCards = computed(() => {
  let result = cards.value
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    result = result.filter(card =>
      card.code.toLowerCase().includes(query)
      || card.description.toLowerCase().includes(query)
      || (card.usedByName && card.usedByName.toLowerCase().includes(query)),
    )
  }
  if (statusFilter.value !== 'all')
    result = result.filter(card => statusFilter.value === 'used' ? !!card.usedBy : !card.usedBy)
  if (typeFilter.value !== 'all')
    result = result.filter(card => card.type === typeFilter.value)
  return result
})

const selectedCodes = ref<Set<string>>(new Set())
const selectedCount = computed(() => selectedCodes.value.size)
const allSelected = computed(() =>
  filteredCards.value.length > 0 && filteredCards.value.every(card => selectedCodes.value.has(card.code)),
)

function toggleSelectAll() {
  if (allSelected.value) {
    selectedCodes.value.clear()
    return
  }
  filteredCards.value.forEach(card => selectedCodes.value.add(card.code))
}

function toggleSelectCard(code: string) {
  if (selectedCodes.value.has(code))
    selectedCodes.value.delete(code)
  else
    selectedCodes.value.add(code)
}

async function handleCopyCode(code: string) {
  try {
    await copyTextToClipboard(code)
    toast.success('卡密已复制到剪贴板')
  }
  catch {
    toast.error('复制失败，请手动复制')
  }
}

async function handleCopySelected() {
  if (!selectedCount.value)
    return
  try {
    await copyTextToClipboard(Array.from(selectedCodes.value).join('\n'))
    toast.success(`已复制 ${selectedCount.value} 个卡密到剪贴板`)
  }
  catch {
    toast.error('复制失败，请手动复制')
  }
}

function handleExportFiltered() {
  const target = selectedCount.value > 0
    ? cards.value.filter(card => selectedCodes.value.has(card.code))
    : filteredCards.value
  if (!target.length) {
    toast.warning('没有可导出的卡密')
    return
  }
  exportCardsToText(target)
  toast.success(`已导出 ${target.length} 个卡密`)
}

// ==================== 删除 ====================
const showDeleteConfirm = ref(false)
const deleteLoading = ref(false)
const pendingDeleteCodes = ref<string[]>([])
const deleteConfirmMessage = computed(() =>
  pendingDeleteCodes.value.length === 1
    ? `确定要删除卡密 ${pendingDeleteCodes.value[0]} 吗？此操作不可恢复！`
    : `确定要删除选中的 ${pendingDeleteCodes.value.length} 个卡密吗？此操作不可恢复！`,
)

function requestDeleteCard(card: CardRecord) {
  pendingDeleteCodes.value = [card.code]
  showDeleteConfirm.value = true
}

function requestDeleteSelected() {
  if (!selectedCount.value) {
    toast.warning('请先选择要删除的卡密')
    return
  }
  pendingDeleteCodes.value = Array.from(selectedCodes.value)
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  deleteLoading.value = true
  try {
    const result = await cardStore.deleteCards(pendingDeleteCodes.value)
    if (result.ok) {
      toast.success(`成功删除 ${result.deletedCount} 个卡密`)
      if (result.notFoundCount)
        toast.warning(`${result.notFoundCount} 个卡密未找到`)
      pendingDeleteCodes.value.forEach(code => selectedCodes.value.delete(code))
      showDeleteConfirm.value = false
    }
  }
  finally {
    deleteLoading.value = false
  }
}

// ==================== 核销卡密 ====================
const redeemCode = ref('')
const redeemAccountId = ref('')
const redeemLoading = ref(false)
const showRedeemConfirm = ref(false)

const accountOptions = computed(() =>
  accounts.value.map((acc: any) => ({
    label: `${acc.name || acc.nick || acc.id}${acc.uin ? `（${acc.uin}）` : ''}`,
    value: String(acc.id),
  })),
)

const redeemTargetType = computed<'time' | 'quota' | ''>(() => {
  const code = redeemCode.value.trim().toUpperCase()
  if (!code)
    return ''
  const card = cards.value.find(item => item.code === code)
  return card ? card.type : ''
})

async function requestRedeem() {
  if (!redeemCode.value.trim()) {
    toast.warning('请输入要核销的卡密')
    return
  }
  if (redeemTargetType.value === 'time' && !redeemAccountId.value) {
    toast.warning('时间卡密需要选择绑定的账号')
    return
  }
  showRedeemConfirm.value = true
}

async function confirmRedeem() {
  redeemLoading.value = true
  try {
    const result = await cardStore.useCard(redeemCode.value, redeemAccountId.value || undefined)
    if (result.ok) {
      toast.success(result.cardType === 'quota' ? '额度卡核销成功，账号上限已提升' : '时间卡核销成功，账号有效期已续期')
      redeemCode.value = ''
      redeemAccountId.value = ''
      showRedeemConfirm.value = false
    }
  }
  finally {
    redeemLoading.value = false
  }
}

onMounted(async () => {
  localAccountLimit.value = overview.value.settings.accountLimit
  await Promise.all([cardStore.fetchCards(), accountStore.fetchAccounts()])
  localAccountLimit.value = overview.value.settings.accountLimit
})
</script>

<template>
  <div class="space-y-4">
    <!-- 管控设置 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400">
          <span class="i-carbon-settings-adjust text-xl" />
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            卡密管控
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {{ settingsSummary }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
        <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
          <BaseSwitch
            :model-value="overview.settings.enabled"
            label="启用卡密管控"
            @update:model-value="handleEnabledChange"
          />
        </div>
        <BaseInput
          v-model="localAccountLimit"
          type="number"
          label="账号数量上限"
          :min="0"
          :step="1"
          placeholder="0 表示未设置"
        />
        <div class="flex items-end">
          <BaseButton
            variant="primary"
            size="sm"
            class="w-full sm:w-auto"
            :loading="settingsSaving"
            @click="handleSaveSettings"
          >
            保存设置
          </BaseButton>
        </div>
      </div>
    </section>

    <!-- 创建卡密 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
          <span class="i-carbon-add text-xl" />
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            生成卡密
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            时间卡为账号续期，额度卡提升账号数量上限；批量生成会自动导出文本文件
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BaseSelect
          v-model="newCardForm.type"
          label="卡密类型"
          :options="cardTypeOptions"
        />
        <BaseInput
          v-model="newCardForm.description"
          label="卡密描述"
          type="text"
          placeholder="例如：渠道 A 月卡"
        />
        <template v-if="newCardForm.type === 'time'">
          <BaseInput
            v-model="newCardForm.durationValue"
            type="number"
            label="时长"
            :min="1"
            :step="1"
            placeholder="例如：30"
          />
          <div class="space-y-2">
            <BaseSelect
              v-model="newCardForm.durationUnit"
              label="单位"
              :options="[{ label: '天', value: 'day' }, { label: '小时', value: 'hour' }]"
            />
            <BaseSwitch v-model="newCardForm.isPermanent" label="永久卡" />
          </div>
        </template>
        <template v-else>
          <BaseInput
            v-model="newCardForm.value"
            type="number"
            label="增加额度（个）"
            :min="1"
            :step="1"
            placeholder="例如：1"
          />
        </template>
        <BaseInput
          v-model="newCardForm.count"
          type="number"
          label="生成数量"
          :min="1"
          :max="100"
          :step="1"
          placeholder="1-100"
        />
        <div class="flex items-end">
          <BaseButton
            variant="primary"
            size="sm"
            class="w-full sm:w-auto"
            :loading="creating"
            @click="handleCreateCard"
          >
            生成卡密
          </BaseButton>
        </div>
      </div>
    </section>

    <!-- 核销卡密 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
          <span class="i-carbon-checkmark-outline text-xl" />
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            核销卡密
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            时间卡核销到指定账号（在剩余有效期上叠加），额度卡直接提升账号上限
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BaseInput
          v-model="redeemCode"
          label="卡密"
          type="text"
          placeholder="输入 16 位卡密"
        />
        <BaseSelect
          v-model="redeemAccountId"
          label="绑定账号（时间卡必选）"
          :options="accountOptions"
          :disabled="redeemTargetType === 'quota'"
          placeholder="选择要续期的账号"
          clearable
          filterable
        />
        <div class="flex items-end">
          <BaseButton
            variant="primary"
            size="sm"
            class="w-full sm:w-auto"
            :loading="redeemLoading"
            @click="requestRedeem"
          >
            核销
          </BaseButton>
        </div>
      </div>
    </section>

    <!-- 卡密列表 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <span class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400">
            <span class="i-carbon-list text-xl" />
          </span>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              卡密列表
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              共 {{ cards.length }} 个 · 未使用 {{ cardStore.unusedCount }} · 已使用 {{ cardStore.usedCount }}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :disabled="selectedCount === 0"
            @click="handleCopySelected"
          >
            <span class="i-carbon-copy mr-1" />
            复制选中({{ selectedCount }})
          </BaseButton>
          <BaseButton
            variant="secondary"
            size="sm"
            @click="handleExportFiltered"
          >
            <span class="i-carbon-download mr-1" />
            导出
          </BaseButton>
          <BaseButton
            variant="danger"
            size="sm"
            :disabled="selectedCount === 0"
            @click="requestDeleteSelected"
          >
            <span class="i-carbon-trash-can mr-1" />
            批量删除
          </BaseButton>
        </div>
      </div>

      <div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <BaseInput
          v-model="searchQuery"
          type="text"
          placeholder="搜索卡密 / 描述 / 使用者"
          clearable
        />
        <BaseSelect v-model="statusFilter" :options="statusOptions" />
        <BaseSelect v-model="typeFilter" :options="typeOptions" />
      </div>

      <div v-if="loading && cards.length === 0" class="py-8 text-center text-gray-500">
        <span class="i-carbon-circle-dash mb-2 inline-block animate-spin text-2xl" />
        <div>加载中...</div>
      </div>

      <div v-else-if="filteredCards.length === 0" class="rounded-2xl bg-white py-12 text-center dark:bg-gray-800">
        <div class="i-carbon-ticket mb-4 inline-block text-4xl text-gray-400" />
        <p class="text-gray-500">
          暂无卡密，先在上方生成
        </p>
      </div>

      <div v-else class="space-y-2">
        <label class="flex items-center gap-2 px-1 text-sm text-gray-500 dark:text-gray-400">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-gray-300"
            :checked="allSelected"
            @change="toggleSelectAll"
          >
          全选（{{ filteredCards.length }}）
        </label>

        <div
          v-for="card in filteredCards"
          :key="card.code"
          class="border border-gray-100 rounded-xl bg-white p-3 transition-colors dark:border-gray-700 dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/40"
        >
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <input
                type="checkbox"
                class="h-4 w-4 shrink-0 rounded border-gray-300"
                :checked="selectedCodes.has(card.code)"
                @change="toggleSelectCard(card.code)"
              >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-mono text-sm font-bold tracking-wider text-gray-900 dark:text-gray-100">{{ card.code }}</span>
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                    :class="card.type === 'quota'
                      ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400'
                      : 'bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400'"
                  >
                    {{ getCardTypeLabel(card) }} · {{ formatCardValue(card) }}
                  </span>
                  <span
                    v-if="card.usedBy"
                    class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  >
                    已使用
                  </span>
                  <span
                    v-else-if="!card.enabled"
                    class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-red-500 dark:bg-red-900/25 dark:text-red-400"
                  >
                    已禁用
                  </span>
                  <span
                    v-else
                    class="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-green-600 dark:bg-green-900/25 dark:text-green-400"
                  >
                    可用
                  </span>
                </div>
                <p class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                  {{ card.description || '无描述' }} · 创建于 {{ formatCardDate(card.createdAt) }}
                  <template v-if="card.usedBy">
                    · {{ card.usedByName || card.usedBy }} 于 {{ formatCardDate(card.usedAt) }}
                  </template>
                </p>
              </div>
            </div>

            <div class="flex shrink-0 justify-end gap-1">
              <BaseButton
                variant="ghost"
                class="min-h-[36px] min-w-[36px] !p-2"
                title="复制卡密"
                @click="handleCopyCode(card.code)"
              >
                <span class="i-carbon-copy" />
              </BaseButton>
              <BaseButton
                v-if="!card.usedBy"
                variant="ghost"
                class="min-h-[36px] min-w-[36px] !p-2"
                :title="card.enabled ? '禁用' : '启用'"
                @click="cardStore.toggleCard(card)"
              >
                <span :class="card.enabled ? 'i-carbon-invisible' : 'i-carbon-view'" />
              </BaseButton>
              <BaseButton
                variant="ghost"
                class="min-h-[36px] min-w-[36px] text-red-500 !p-2 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
                title="删除"
                @click="requestDeleteCard(card)"
              >
                <span class="i-carbon-trash-can" />
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </section>

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="删除卡密"
      :message="deleteConfirmMessage"
      confirm-text="删除"
      type="danger"
      @cancel="!deleteLoading && (showDeleteConfirm = false)"
      @confirm="confirmDelete"
    />

    <ConfirmModal
      :show="showEnableConfirm"
      :loading="settingsSaving"
      title="开启卡密管控"
      message="开启后新增游戏账号将受账号数量上限约束，超出上限时需核销额度卡密；到期账号会被自动停用。确定开启吗？"
      confirm-text="开启"
      @cancel="showEnableConfirm = false"
      @confirm="confirmEnableCardControl"
    />

    <ConfirmModal
      :show="showRedeemConfirm"
      :loading="redeemLoading"
      title="核销卡密"
      :message="redeemTargetType === 'quota'
        ? '额度卡核销后立即提升账号数量上限，此操作不可恢复。确定核销吗？'
        : `时间卡核销后将叠加到所选账号的有效期，此操作不可恢复。确定核销吗？`"
      confirm-text="核销"
      @cancel="!redeemLoading && (showRedeemConfirm = false)"
      @confirm="confirmRedeem"
    />
  </div>
</template>
