<script setup lang="ts">
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { computed, onMounted, ref } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'

interface ManagedUser {
  username: string
  role: 'user'
  enabled: boolean
  card: { code: string, description: string, expiresAt: number | null, isPermanent: boolean }
  accountLimit: number
  gameAccountCount: number
  referredBy?: string
  validPurchase?: boolean
  isAgent?: boolean
  createdAt: number
  expired: boolean
}

const toast = useToastStore()

const users = ref<ManagedUser[]>([])
const loading = ref(false)
const searchQuery = ref('')

const filteredUsers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query)
    return users.value
  return users.value.filter(user => user.username.toLowerCase().includes(query))
})

function formatExpiry(card: ManagedUser['card']) {
  if (card.isPermanent || card.expiresAt === null)
    return '永久'
  if (!card.expiresAt)
    return '-'
  return new Date(card.expiresAt).toLocaleString('zh-CN')
}

function expiryState(user: ManagedUser) {
  if (user.card.isPermanent || user.card.expiresAt === null)
    return { text: '永久', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400' }
  if (user.expired)
    return { text: '已到期', cls: 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-400' }
  const remainDays = Math.ceil((Number(user.card.expiresAt) - Date.now()) / 86400000)
  return { text: `剩 ${remainDays} 天`, cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400' }
}

function toDatetimeLocal(ts: number | null | undefined) {
  if (!ts)
    return ''
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// ==================== 编辑 ====================
const showEditModal = ref(false)
const editSaving = ref(false)
const editingUser = ref<ManagedUser | null>(null)
const editForm = ref({
  isPermanent: false,
  expiresAt: '',
  accountLimit: 2,
  enabled: true,
  isAgent: false,
  newPassword: '',
})

function openEditModal(user: ManagedUser) {
  editingUser.value = user
  editForm.value = {
    isPermanent: user.card.isPermanent || user.card.expiresAt === null,
    expiresAt: toDatetimeLocal(user.card.expiresAt),
    accountLimit: user.accountLimit,
    enabled: user.enabled,
    isAgent: user.isAgent === true,
    newPassword: '',
  }
  showEditModal.value = true
}

async function confirmEdit() {
  if (!editingUser.value)
    return
  if (!editForm.value.isPermanent && !editForm.value.expiresAt.trim()) {
    toast.warning('请填写到期时间，或开启永久')
    return
  }
  editSaving.value = true
  try {
    const payload: Record<string, unknown> = {
      expiresAt: editForm.value.isPermanent ? null : editForm.value.expiresAt.trim(),
      accountLimit: Number(editForm.value.accountLimit) || 2,
      enabled: editForm.value.enabled,
      isAgent: editForm.value.isAgent,
    }
    if (editForm.value.newPassword.trim())
      payload.newPassword = editForm.value.newPassword.trim()

    const { data } = await api.post(`/api/admin/users/${editingUser.value.username}`, payload)
    if (data?.ok) {
      toast.success(`用户 ${editingUser.value.username} 已更新`)
      showEditModal.value = false
      await fetchUsers()
    }
  }
  finally {
    editSaving.value = false
  }
}

// ==================== 删除 ====================
const showDeleteConfirm = ref(false)
const deleteLoading = ref(false)
const pendingDeleteUser = ref<ManagedUser | null>(null)
const deleteForce = ref(false)

const deleteMessage = computed(() => {
  if (!pendingDeleteUser.value)
    return ''
  const count = pendingDeleteUser.value.gameAccountCount
  if (count > 0) {
    return `用户 ${pendingDeleteUser.value.username} 名下还有 ${count} 个游戏账号。${deleteForce.value ? '已选择连同账号一起删除，此操作不可恢复！' : '默认仅删除用户，勾选下方可连同账号一起删除。'}`
  }
  return `确定要删除用户 ${pendingDeleteUser.value.username} 吗？此操作不可恢复！`
})

function requestDelete(user: ManagedUser) {
  pendingDeleteUser.value = user
  deleteForce.value = false
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (!pendingDeleteUser.value)
    return
  deleteLoading.value = true
  try {
    const force = deleteForce.value && pendingDeleteUser.value.gameAccountCount > 0
    const { data } = await api.delete(`/api/admin/users/${pendingDeleteUser.value.username}`, {
      params: force ? { force: 1 } : {},
    })
    if (data?.ok) {
      toast.success(`用户 ${pendingDeleteUser.value.username} 已删除${data.removedAccounts ? `，连同 ${data.removedAccounts} 个游戏账号` : ''}`)
      showDeleteConfirm.value = false
      await fetchUsers()
    }
  }
  finally {
    deleteLoading.value = false
  }
}

async function fetchUsers() {
  loading.value = true
  try {
    const { data } = await api.get('/api/admin/users')
    if (data?.ok)
      users.value = Array.isArray(data.data) ? data.data : []
  }
  finally {
    loading.value = false
  }
}

onMounted(fetchUsers)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          用户管理
        </h3>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          管理卡密注册的普通用户：到期时间、账号上限、启用状态与密码
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <BaseInput
          v-model="searchQuery"
          type="text"
          placeholder="搜索用户名"
          clearable
        />
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="loading"
          @click="fetchUsers"
        >
          <span class="i-carbon-renew mr-1" />
          刷新
        </BaseButton>
      </div>
    </div>

    <div v-if="loading && users.length === 0" class="py-8 text-center text-gray-500">
      <span class="i-carbon-circle-dash mb-2 inline-block animate-spin text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else-if="filteredUsers.length === 0" class="farm-card rounded-2xl bg-white py-12 text-center shadow-md dark:bg-gray-800">
      <div class="i-carbon-user-multiple mb-4 inline-block text-4xl text-gray-400" />
      <p class="text-gray-500">
        暂无注册用户，用户可在登录页使用时间卡密注册
      </p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="user in filteredUsers"
        :key="user.username"
        class="border border-transparent cartoon-card rounded-2xl bg-white p-4 shadow-md transition-all duration-200 dark:bg-gray-800"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <h4 class="truncate text-base font-bold">
                {{ user.username }}
              </h4>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                :class="expiryState(user).cls"
              >
                {{ expiryState(user).text }}
              </span>
              <span
                v-if="!user.enabled"
                class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-red-500 dark:bg-red-900/25 dark:text-red-400"
              >
                已停用
              </span>
              <span
                v-if="user.isAgent"
                class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-amber-600 dark:bg-amber-900/25 dark:text-amber-400"
              >
                代理 · 7 折
              </span>
            </div>
            <p class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
              到期：{{ formatExpiry(user.card) }} · 账号 {{ user.gameAccountCount }}/{{ user.accountLimit }}
            </p>
            <p class="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
              注册卡：{{ user.card.code || '-' }} · {{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}
            </p>
          </div>
        </div>

        <div class="mt-3 flex justify-end gap-1 border-t border-gray-100 pt-3 dark:border-gray-700">
          <BaseButton
            variant="ghost"
            class="min-h-[36px] min-w-[36px] !p-2"
            title="编辑"
            @click="openEditModal(user)"
          >
            <span class="i-carbon-edit" />
          </BaseButton>
          <BaseButton
            variant="ghost"
            class="min-h-[36px] min-w-[36px] text-red-500 !p-2 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
            title="删除"
            @click="requestDelete(user)"
          >
            <span class="i-carbon-trash-can" />
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 编辑用户 -->
    <NModal
      :show="showEditModal"
      :mask-closable="!editSaving"
      :auto-focus="false"
      @update:show="(value: boolean) => !editSaving && (showEditModal = value)"
    >
      <NCard
        class="edit-card"
        :bordered="false"
        :title="`编辑用户 ${editingUser?.username || ''}`"
        size="medium"
      >
        <div class="space-y-3">
          <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="editForm.isPermanent" label="永久有效" />
          </div>
          <BaseInput
            v-if="!editForm.isPermanent"
            v-model="editForm.expiresAt"
            type="text"
            label="到期时间"
            placeholder="YYYY-MM-DD HH:mm"
          />
          <BaseInput
            v-model="editForm.accountLimit"
            type="number"
            label="账号数量上限"
            :min="1"
            :step="1"
          />
          <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="editForm.enabled" label="启用登录" />
          </div>
          <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="editForm.isAgent" label="代理身份（7 折拿卡）" />
          </div>
          <BaseInput
            v-model="editForm.newPassword"
            type="password"
            label="重置密码（留空表示不修改）"
            placeholder="至少6位，含两种字符类型"
          />
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <BaseButton variant="secondary" :disabled="editSaving" @click="showEditModal = false">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="editSaving" @click="confirmEdit">
              保存
            </BaseButton>
          </div>
        </template>
      </NCard>
    </NModal>

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="删除用户"
      :message="deleteMessage"
      confirm-text="删除"
      type="danger"
      @cancel="!deleteLoading && (showDeleteConfirm = false)"
      @confirm="confirmDelete"
    >
      <label
        v-if="pendingDeleteUser && pendingDeleteUser.gameAccountCount > 0"
        class="mt-2 flex items-center gap-2 text-sm"
      >
        <input
          v-model="deleteForce"
          type="checkbox"
          class="h-4 w-4 rounded border-gray-300"
        >
        连同名下 {{ pendingDeleteUser.gameAccountCount }} 个游戏账号一起删除
      </label>
    </ConfirmModal>
  </div>
</template>

<style scoped>
.edit-card {
  width: min(440px, calc(100vw - 32px));
}
</style>
