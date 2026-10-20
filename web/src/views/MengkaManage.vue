<script setup lang="ts">
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import MengkaLoginPanel from '@/components/MengkaLoginPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useMengkaLogin } from '@/composables/useMengkaLogin'
import { useUserStore } from '@/stores/user'

interface MengkaBot {
  selfId: string
  nickname: string
  clientType: string
  online: boolean
  status: number
  lastActive: number | string
  loginTime: number | string
  owner?: string | null
}

interface OwnerOption { username: string }

const userStore = useUserStore()

const enabled = ref(false)
const connected = ref(false)
const nodeLabel = ref('')
const bots = ref<MengkaBot[]>([])
const loading = ref(false)
const initialized = ref(false)

const showAddModal = ref(false)
const dialogMode = ref<'add' | 'relogin'>('add')
const reloginBot = ref<MengkaBot | null>(null)
const ownerTarget = ref('')
const ownerOptions = ref<OwnerOption[]>([])

const unbindTarget = ref<MengkaBot | null>(null)
const showUnbindConfirm = ref(false)
const unbindLoading = ref(false)

const isAdmin = computed(() => userStore.isAdmin)

const androidBots = computed(() => bots.value.filter(bot => bot.clientType === 'android'))

const mengkaLogin = useMengkaLogin({
  getOwner: () => (isAdmin.value && ownerTarget.value ? ownerTarget.value : undefined),
  onSuccess: async () => {
    await loadBots()
  },
})

// 验证流程进行中（扫码/短信/滑块）禁止误关弹窗
const mengkaLoginBusy = computed(() => ['qr', 'verify', 'sms', 'slider'].includes(mengkaLogin.step))

function formatTs(value: number | string): string {
  const ts = Number(value)
  if (!Number.isFinite(ts) || ts <= 0)
    return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

function statusText(bot: MengkaBot): string {
  if (bot.online || bot.status === 1)
    return '在线'
  return bot.status === 2 ? '登录中' : '离线'
}

function statusClass(bot: MengkaBot): string {
  if (bot.online || bot.status === 1)
    return 'bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400'
  if (bot.status === 2)
    return 'bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400'
  return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
}

async function loadStatus() {
  try {
    const { data } = await api.get('/api/mengka/status', { skipErrorToast: true } as any)
    enabled.value = data?.ok && data.data?.enabled === true
    connected.value = data?.data?.connected === true
    const nodes = Array.isArray(data?.data?.nodes) ? data.data.nodes : []
    const node = nodes[0] || {}
    const parts = [String(node.name || node.title || '').trim()]
    const running = Number(node.running ?? node.account_count)
    const total = Number(node.total ?? node.capacity)
    if (Number.isFinite(running) && Number.isFinite(total) && total > 0)
      parts.push(`${running}/${total} 运行`)
    nodeLabel.value = parts.filter(Boolean).join('，') || (connected.value ? '已连接萌卡框架' : '未连接')
  }
  catch {
    enabled.value = false
  }
}

async function loadBots() {
  loading.value = true
  try {
    const { data } = await api.get('/api/mengka/bots', { skipErrorToast: true } as any)
    bots.value = Array.isArray(data?.data?.bots) ? data.data.bots : []
  }
  catch {
    bots.value = []
  }
  finally {
    loading.value = false
  }
}

async function loadAll() {
  await Promise.all([loadStatus(), loadBots()])
  initialized.value = true
}

async function loadOwnerOptions() {
  if (!isAdmin.value || ownerOptions.value.length)
    return
  try {
    const { data } = await api.get('/api/admin/users', { skipErrorToast: true } as any)
    ownerOptions.value = Array.isArray(data?.data) ? data.data : []
  }
  catch {
    ownerOptions.value = []
  }
}

function openAddModal() {
  dialogMode.value = 'add'
  reloginBot.value = null
  mengkaLogin.reset()
  void loadOwnerOptions()
  showAddModal.value = true
}

function openRelogin(bot: MengkaBot) {
  dialogMode.value = 'relogin'
  reloginBot.value = bot
  mengkaLogin.reset()
  showAddModal.value = true
}

function askUnbind(bot: MengkaBot) {
  unbindTarget.value = bot
  showUnbindConfirm.value = true
}

async function confirmUnbind() {
  const target = unbindTarget.value
  if (!target)
    return
  unbindLoading.value = true
  try {
    const { data } = await api.delete(`/api/mengka/bindings/${target.selfId}`)
    if (data?.ok) {
      showUnbindConfirm.value = false
      unbindTarget.value = null
      await loadBots()
    }
    else {
      showUnbindConfirm.value = false
      unbindTarget.value = null
    }
  }
  catch (e: any) {
    showUnbindConfirm.value = false
    unbindTarget.value = null
    console.error('解绑失败:', getApiErrorMessage(e, '未知错误'))
  }
  finally {
    unbindLoading.value = false
  }
}

// 30 秒自动刷新在线状态
useIntervalFn(() => {
  if (enabled.value && connected.value && !showAddModal.value)
    void loadBots()
}, 30000, { immediate: false })

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div class="page-stack">
    <div class="settings-content space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
            <div class="i-carbon-qr-code text-lg" />
            萌卡管理
          </h3>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            在这里扫码添加你的 QQ 到萌卡、查看在线状态、掉线重新登录
          </p>
        </div>
        <BaseButton variant="outline" size="sm" :loading="loading" @click="loadAll">
          刷新
        </BaseButton>
      </div>

      <div v-if="!initialized && loading" class="py-8 text-center text-gray-500">
        <span class="i-carbon-circle-dash mb-2 inline-block animate-spin text-2xl" />
        <div>加载中...</div>
      </div>

      <template v-else-if="!enabled">
        <EmptyState
          title="萌卡对接未启用"
          description="管理员尚未开启萌卡对接，开启后即可在这里添加和管理你的 QQ"
          icon="i-carbon-plug"
        />
      </template>

      <template v-else>
        <!-- 连接状态 -->
        <section class="farm-card flex items-start gap-3 rounded-lg p-4">
          <div
            class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg"
            :class="connected ? 'bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400' : 'bg-red-50 text-red-500 dark:bg-red-900/25 dark:text-red-400'"
          >
            <span :class="connected ? 'i-carbon-checkmark' : 'i-carbon-warning'" class="text-xl" />
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              {{ connected ? '已连接萌卡框架' : '萌卡框架未连接' }}
            </h4>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ connected ? `当前机器人节点：${nodeLabel}` : '连接不可用，请联系管理员检查萌卡对接配置' }}
            </p>
          </div>
          <BaseButton variant="primary" size="sm" :disabled="!connected" @click="openAddModal">
            扫码添加 QQ
          </BaseButton>
        </section>

        <!-- 账号列表 -->
        <section class="farm-card rounded-lg p-4">
          <div class="mb-4 flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
              <span class="i-carbon-user-avatar text-xl" />
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                {{ isAdmin ? '萌卡账号' : '我的 QQ' }}（{{ androidBots.length }}）
              </h4>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {{ isAdmin ? '框架内全部安卓账号，含归属标注' : '这些 QQ 已绑定到你的账号，可用于一键授权添加农场账号' }}
              </p>
            </div>
          </div>

          <div v-if="androidBots.length === 0">
            <EmptyState
              title="还没有添加 QQ"
              description="点击「扫码添加 QQ」，用手机 QQ 扫码即可自动登录并绑定到你的账号"
              icon="i-carbon-qr-code"
            />
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="bot in androidBots"
              :key="bot.selfId"
              class="flex flex-col gap-2 border border-gray-100 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-sm font-bold text-gray-900 dark:text-gray-100">{{ bot.nickname || bot.selfId }}</span>
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                    :class="statusClass(bot)"
                  >
                    {{ statusText(bot) }}
                  </span>
                  <span
                    v-if="isAdmin && bot.owner"
                    class="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-violet-600 dark:bg-violet-900/25 dark:text-violet-400"
                  >
                    归属：{{ bot.owner }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  QQ {{ bot.selfId }} · 最后活跃 {{ formatTs(bot.lastActive) }}
                </p>
              </div>
              <div class="flex flex-none items-center gap-2">
                <BaseButton
                  v-if="!bot.online"
                  variant="outline"
                  size="sm"
                  :loading="mengkaLogin.loading"
                  @click="openRelogin(bot)"
                >
                  重新登录
                </BaseButton>
                <BaseButton variant="outline" size="sm" @click="askUnbind(bot)">
                  解绑
                </BaseButton>
              </div>
            </div>
          </div>
        </section>

        <!-- 使用说明 -->
        <section class="farm-card rounded-lg p-4">
          <div class="mb-3 flex items-start gap-3">
            <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400">
              <span class="i-carbon-information text-xl" />
            </div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              使用说明
            </h4>
          </div>
          <ol class="list-decimal space-y-1.5 pl-5 text-xs text-gray-500 leading-relaxed dark:text-gray-400">
            <li>「扫码添加 QQ」后用手机 QQ 扫描二维码并确认，即可自动登录到萌卡框架并绑定到当前账号。</li>
            <li>掉线的 QQ 可点「重新登录」恢复在线；需要验证时会弹出二维码。</li>
            <li>添加农场账号时，在「添加账号 → 萌卡登录」页签选择在线 QQ 即可一键获取授权 Code。</li>
            <li>解绑后该 QQ 将不再显示在列表中，可以被其他账号重新绑定。</li>
          </ol>
        </section>
      </template>
    </div>

    <!-- 扫码添加 / 重新登录弹窗 -->
    <NModal :show="showAddModal" @update:show="value => !mengkaLoginBusy && (showAddModal = value)">
      <NCard
        class="mengka-modal-card"
        :title="dialogMode === 'relogin' ? '重新登录' : '扫码添加 QQ'"
        :bordered="false"
        :closable="!mengkaLogin.loading"
        @close="mengkaLogin.reset(); showAddModal = false"
      >
        <MengkaLoginPanel
          :login="mengkaLogin"
          :mode="dialogMode"
          :relogin-bot="reloginBot"
          @close="mengkaLogin.reset(); showAddModal = false"
        >
          <template #header>
            <div v-if="isAdmin">
              <BaseSelect
                v-model="ownerTarget"
                label="账号归属"
                :options="[
                  { label: '超级管理员', value: '' },
                  ...ownerOptions.map(user => ({ label: user.username, value: user.username })),
                ]"
              />
              <p class="mt-1 text-xs opacity-60">
                扫码登录的新 QQ 会归属到所选用户
              </p>
            </div>
            <p class="text-xs opacity-60">
              发起后按提示完成验证（短信验证码 / 扫码），成功后自动绑定到当前账号
            </p>
          </template>
        </MengkaLoginPanel>
      </NCard>
    </NModal>

    <!-- 解绑确认 -->
    <ConfirmModal
      :show="showUnbindConfirm"
      :loading="unbindLoading"
      title="解绑萌卡账号"
      :message="unbindTarget ? `确定解绑 ${unbindTarget.nickname || unbindTarget.selfId}（${unbindTarget.selfId}）？解绑后将无法使用该 QQ 一键授权，可重新扫码绑定` : ''"
      confirm-text="确认解绑"
      type="danger"
      @close="!unbindLoading && (showUnbindConfirm = false)"
      @cancel="!unbindLoading && (showUnbindConfirm = false)"
      @confirm="confirmUnbind"
    />
  </div>
</template>

<style scoped>
.mengka-modal-card {
  width: min(420px, calc(100vw - 32px));
}
</style>
