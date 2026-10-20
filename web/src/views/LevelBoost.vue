<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useToastStore } from '@/stores/toast'

interface LevelAccount {
  selfId: string
  nickname: string
  status: number
  online: boolean
  level: number
  levelTaskSupported: boolean
  owner: string | null
}

interface LevelTask {
  title: string
  sub_title?: string
  is_done?: boolean
  executable?: boolean
  speed_days?: number
  available?: boolean
  can_execute?: boolean
  is_paid_task?: boolean
  status_text?: string
  execution_message?: string
}

interface LevelPayload {
  daily_totals_available?: boolean
  overall_info?: { total_days?: number | null, base_days?: number | null, extra_days?: number | null, vip_speed?: number | null } | null
  base_info?: { base_task_list?: LevelTask[] } | null
  extra_info?: { extra_task_list?: LevelTask[] } | null
  member_info?: { member_task_list?: LevelTask[] } | null
  vip_info?: { vip_list?: LevelTask[] } | null
  is_freeze?: boolean
}

interface LevelSettings {
  selectedTasks?: string[]
  scheduleEnabled?: boolean
  scheduleTime?: string
  lastRunDate?: string
}

interface LevelProfile {
  level?: number
  upgradeRequiredDays?: number
  nextLevelTotalDays?: number
  activeDaysAvailable?: boolean
  activeDays?: number
  remainingUpgradeDays?: number
}

interface TaskGroup { key: string, label: string, tasks: LevelTask[] }

const toast = useToastStore()

const accounts = ref<LevelAccount[]>([])
const selectedSelfId = ref('')
const loadError = ref('')
const capabilityError = ref('')
const loadingAccounts = ref(false)
const loadingPanel = ref(false)
const refreshing = ref(false)
const executing = ref(false)
const savingSettings = ref(false)

const payload = ref<LevelPayload | null>(null)
const settingsInfo = ref<LevelSettings | null>(null)
const profile = ref<LevelProfile | null>(null)

// 补挂勾选（任务标题列表）
const executeSelected = ref<string[]>([])
// 自动执行计划表单
const settingsForm = reactive({
  selectedTasks: [] as string[],
  scheduleEnabled: false,
  scheduleTime: '04:00',
})

const accountOptions = computed(() => accounts.value.map(item => ({
  label: `${item.nickname || item.selfId}（${item.selfId}）· Lv.${item.level}${item.online ? '' : ' · 离线'}${item.owner ? ` · ${item.owner}` : ''}`,
  value: item.selfId,
})))

const taskGroups = computed<TaskGroup[]>(() => {
  const p = payload.value
  if (!p)
    return []
  const groups: TaskGroup[] = []
  if (p.base_info?.base_task_list?.length)
    groups.push({ key: 'base', label: '日常任务', tasks: p.base_info.base_task_list })
  if (p.extra_info?.extra_task_list?.length)
    groups.push({ key: 'extra', label: '额外任务', tasks: p.extra_info.extra_task_list })
  if (p.member_info?.member_task_list?.length)
    groups.push({ key: 'member', label: '会员任务', tasks: p.member_info.member_task_list })
  if (p.vip_info?.vip_list?.length)
    groups.push({ key: 'vip', label: '会员权益', tasks: p.vip_info.vip_list })
  return groups
})

const executableTasks = computed(() =>
  taskGroups.value.flatMap(group => group.tasks).filter(task => task.can_execute && !task.is_paid_task))

const totalsAvailable = computed(() => payload.value?.daily_totals_available !== false)
const overall = computed(() => payload.value?.overall_info || null)

function tenths(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return '未知'
  return `${Math.round(Number(value)) / 10}`
}

const vipSpeedLabel = computed(() => {
  const raw = overall.value?.vip_speed
  return raw === null || raw === undefined ? '未知' : `${Math.round(Number(raw)) / 10} 倍`
})

function capabilityMessage(message: string) {
  if (message.includes('不支持等级任务管理'))
    capabilityError.value = message
}

function applySettings(raw: LevelSettings | null) {
  settingsInfo.value = raw
  settingsForm.selectedTasks = Array.isArray(raw?.selectedTasks) ? [...raw.selectedTasks] : []
  settingsForm.scheduleEnabled = raw?.scheduleEnabled === true
  settingsForm.scheduleTime = String(raw?.scheduleTime || '04:00')
}

async function loadPanel(refresh: boolean) {
  if (!selectedSelfId.value)
    return
  refreshing.value = refresh
  loadingPanel.value = !refresh
  loadError.value = ''
  try {
    const { data } = await api.get('/api/mengka/level/panel', {
      params: { selfId: selectedSelfId.value, refresh: refresh ? 1 : 0 },
      timeout: 80000,
      skipErrorToast: true,
    } as any)
    if (data?.ok) {
      payload.value = data.data?.payload || null
      applySettings(data.data?.settings || null)
      profile.value = data.data?.profile || null
      executeSelected.value = []
      if (!payload.value)
        loadError.value = '获取等级任务面板失败：账号可能不在线或协议暂不支持'
    }
    else {
      const message = getApiErrorMessage(data, '获取等级面板失败')
      loadError.value = message
      capabilityMessage(message)
    }
  }
  catch (e) {
    const message = getApiErrorMessage(e, '获取等级面板失败')
    loadError.value = message
    capabilityMessage(message)
  }
  finally {
    refreshing.value = false
    loadingPanel.value = false
  }
}

async function loadAccounts() {
  loadingAccounts.value = true
  loadError.value = ''
  capabilityError.value = ''
  try {
    const { data } = await api.get('/api/mengka/level/accounts', { skipErrorToast: true } as any)
    if (data?.ok) {
      accounts.value = Array.isArray(data.data?.accounts) ? data.data.accounts : []
      const first = accounts.value[0]
      if (!first) {
        loadError.value = '暂无可管理的萌卡账号，请先在「添加账号 → 萌卡登录」中扫码登录 QQ'
      }
      else {
        selectedSelfId.value = first.selfId
        await loadPanel(false)
      }
    }
    else {
      const message = getApiErrorMessage(data, '加载萌卡账号失败')
      loadError.value = message
      capabilityMessage(message)
    }
  }
  catch (e) {
    const message = getApiErrorMessage(e, '加载萌卡账号失败')
    loadError.value = message
    capabilityMessage(message)
  }
  finally {
    loadingAccounts.value = false
  }
}

async function runExecute() {
  if (!executeSelected.value.length || !selectedSelfId.value)
    return
  executing.value = true
  try {
    const { data } = await api.post('/api/mengka/level/execute', {
      selfId: selectedSelfId.value,
      tasks: [...executeSelected.value],
    }, { timeout: 330000, skipErrorToast: true } as any)
    if (data?.ok) {
      const executed: string[] = data.data?.executed || []
      const skipped: string[] = data.data?.skippedTasks || []
      if (data.data?.payload)
        payload.value = data.data.payload
      if (skipped.length)
        toast.warning(`已跳过：${skipped.join('、')}`)
      toast.success(`已执行 ${executed.length} 项等级任务`)
      if (!data.data?.refreshed) {
        if (data.data?.refreshError)
          toast.warning(`刷新面板失败：${data.data.refreshError}`)
        await loadPanel(false)
      }
      executeSelected.value = []
    }
    else {
      toast.error(getApiErrorMessage(data, '执行失败'))
    }
  }
  catch (e) {
    toast.error(getApiErrorMessage(e, '执行失败，请稍后重试'))
  }
  finally {
    executing.value = false
  }
}

async function saveSettings() {
  if (!selectedSelfId.value)
    return
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settingsForm.scheduleTime.trim())) {
    toast.error('执行时间格式需为 HH:mm，例如 04:00')
    return
  }
  savingSettings.value = true
  try {
    const { data } = await api.post('/api/mengka/level/settings', {
      selfId: selectedSelfId.value,
      selectedTasks: settingsForm.selectedTasks,
      scheduleEnabled: settingsForm.scheduleEnabled,
      scheduleTime: settingsForm.scheduleTime.trim(),
    }, { timeout: 30000, skipErrorToast: true } as any)
    if (data?.ok) {
      applySettings(data.data?.settings || null)
      toast.success('自动执行计划已保存，由萌卡框架每日定时执行')
    }
    else {
      toast.error(getApiErrorMessage(data, '保存失败'))
    }
  }
  catch (e) {
    toast.error(getApiErrorMessage(e, '保存失败'))
  }
  finally {
    savingSettings.value = false
  }
}

onMounted(loadAccounts)
</script>

<template>
  <div class="page-stack">
    <div class="settings-content space-y-4">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          等级加速
        </h3>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          通过萌卡框架完成 QQ 等级加速任务：查看每日加速与任务进度、一键补挂任务、配置每日自动执行计划
        </p>
      </div>

      <EmptyState
        v-if="capabilityError"
        title="萌卡框架版本过低"
        :description="capabilityError"
        icon="i-carbon-warning-alt"
      />

      <EmptyState
        v-else-if="loadingAccounts"
        title="正在加载萌卡账号…"
        icon="i-carbon-progress-bar"
      />

      <EmptyState
        v-else-if="!accounts.length"
        title="暂无可管理的萌卡账号"
        :description="loadError || '请先在「添加账号 → 萌卡登录」中扫码登录 QQ'"
        icon="i-carbon-user-avatar"
      />

      <template v-else>
        <div class="rounded-2xl border border-gray-200/70 bg-white/80 p-4 dark:border-gray-700/60 dark:bg-gray-800/60">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <BaseSelect
              v-model="selectedSelfId"
              :options="accountOptions"
              class="flex-1"
              :disabled="loadingPanel || executing"
              @change="() => loadPanel(false)"
            />
            <BaseButton
              variant="secondary"
              :loading="refreshing"
              :disabled="loadingPanel || executing"
              @click="loadPanel(true)"
            >
              {{ refreshing ? '实时刷新中…' : '实时刷新' }}
            </BaseButton>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">QQ 等级</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ profile?.level ?? accounts.find(item => item.selfId === selectedSelfId)?.level ?? '-' }}
              </div>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">升级还需</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ profile?.upgradeRequiredDays ?? '-' }} 天
              </div>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">今日活跃</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ profile?.activeDays ?? '未知' }} 天
              </div>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">今日总加速</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ totalsAvailable ? `${tenths(overall?.total_days)} 天` : '未知' }}
              </div>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">日常加速</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ tenths(overall?.base_days) }} 天
              </div>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">额外加速</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ tenths(overall?.extra_days) }} 天
              </div>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">会员倍速</div>
              <div class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
                {{ vipSpeedLabel }}
              </div>
            </div>
          </div>

          <div v-if="payload?.is_freeze" class="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            当前账号加速已冻结，任务执行不会计入加速
          </div>
          <div v-if="loadError && accounts.length" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
            {{ loadError }}
          </div>
        </div>

        <div v-if="loadingPanel" class="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          正在获取等级任务面板…
        </div>

        <template v-else-if="payload">
          <div class="rounded-2xl border border-gray-200/70 bg-white/80 p-4 dark:border-gray-700/60 dark:bg-gray-800/60">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                勾选未完成任务后一键补挂；账号需在线（免费 48 级 / 会员 16 级以上），执行约需数分钟
              </div>
              <BaseButton
                :loading="executing"
                :disabled="!executeSelected.length || loadingPanel"
                @click="runExecute"
              >
                {{ executing ? '执行中，请勿关闭页面…' : `补挂（${executeSelected.length}）` }}
              </BaseButton>
            </div>
          </div>

          <div
            v-for="group in taskGroups"
            :key="group.key"
            class="rounded-2xl border border-gray-200/70 bg-white/80 p-4 dark:border-gray-700/60 dark:bg-gray-800/60"
          >
            <div class="text-sm text-gray-900 font-bold dark:text-gray-100">
              {{ group.label }}
            </div>
            <div
              v-for="task in group.tasks"
              :key="task.title"
              class="mt-2 flex items-start justify-between gap-3 border-t border-gray-100 pt-2.5 dark:border-gray-700/60 first:border-t-0"
            >
              <label class="flex min-w-0 flex-1 items-start gap-2.5">
                <input
                  v-if="task.can_execute && !task.is_done"
                  v-model="executeSelected"
                  type="checkbox"
                  :value="task.title"
                  :disabled="executing"
                  class="mt-0.5"
                >
                <div class="min-w-0">
                  <div class="text-sm text-gray-900 dark:text-gray-100">
                    {{ task.title }}
                    <span
                      v-if="task.is_paid_task"
                      class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    >付费</span>
                    <span
                      v-if="task.is_done === false && task.can_execute === false && task.executable === false"
                      class="ml-1 text-xs text-gray-400"
                    >不可执行</span>
                  </div>
                  <div v-if="task.sub_title" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {{ task.sub_title }}
                  </div>
                  <div v-if="task.execution_message" class="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                    {{ task.execution_message }}
                  </div>
                </div>
              </label>
              <div class="shrink-0 text-right text-xs">
                <div v-if="task.is_done" class="text-green-600 font-medium dark:text-green-400">
                  已完成<span v-if="task.speed_days" class="ml-1 text-gray-400">+{{ tenths(task.speed_days) }}天</span>
                </div>
                <div v-else-if="task.speed_days" class="text-gray-500 dark:text-gray-400">
                  +{{ tenths(task.speed_days) }}天
                </div>
                <div v-else-if="task.status_text" class="text-gray-400">
                  {{ task.status_text }}
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200/70 bg-white/80 p-4 dark:border-gray-700/60 dark:bg-gray-800/60">
            <div class="text-sm text-gray-900 font-bold dark:text-gray-100">
              自动执行计划
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              保存后由萌卡框架按计划自动执行所选任务（需账号在线）；最近自动执行：{{ settingsInfo?.lastRunDate || '从未执行' }}
            </p>
            <div class="mt-3 space-y-3">
              <label class="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                <input v-model="settingsForm.scheduleEnabled" type="checkbox" :disabled="savingSettings">
                启用每日自动执行
              </label>
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gray-500 dark:text-gray-400">每日执行时间</span>
                <input
                  v-model="settingsForm.scheduleTime"
                  type="time"
                  class="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
                  :disabled="savingSettings"
                >
              </div>
              <div>
                <div class="mb-1.5 text-xs text-gray-500 dark:text-gray-400">
                  计划任务（已选 {{ settingsForm.selectedTasks.length }} / 可选 {{ executableTasks.length }}）
                </div>
                <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <label
                    v-for="task in executableTasks"
                    :key="task.title"
                    class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <input
                      v-model="settingsForm.selectedTasks"
                      type="checkbox"
                      :value="task.title"
                      :disabled="savingSettings"
                    >
                    <span class="min-w-0 truncate">{{ task.title }}</span>
                  </label>
                </div>
                <div v-if="!executableTasks.length" class="text-xs text-gray-400">
                  当前没有可计划执行的任务
                </div>
              </div>
              <BaseButton :loading="savingSettings" :disabled="loadingPanel || executing" @click="saveSettings">
                保存计划
              </BaseButton>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
