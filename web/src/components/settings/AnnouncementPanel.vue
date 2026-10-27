<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

/**
 * 公告管理（管理员）：发布/编辑/删除系统公告。
 * 公告按发布时间倒序展示给全体用户，新公告在顶栏图标上以红点提醒。
 */

interface Announcement {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

const announcements = ref<Announcement[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const editingId = ref('')
const title = ref('')
const content = ref('')

const showDeleteConfirm = ref(false)
const deleteTarget = ref<Announcement | null>(null)
const deleteLoading = ref(false)

function fmtTime(timestamp: number) {
  if (!timestamp)
    return '—'
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function fetchAnnouncements() {
  loading.value = true
  try {
    const { data } = await api.get('/api/admin/announcements', { skipErrorToast: true } as any)
    if (data?.ok && data.data)
      announcements.value = Array.isArray(data.data.announcements) ? data.data.announcements : []
    else
      error.value = getApiErrorMessage(data, '获取公告列表失败')
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '获取公告列表失败')
  }
  finally {
    loading.value = false
  }
}

function resetForm() {
  editingId.value = ''
  title.value = ''
  content.value = ''
}

function startEdit(item: Announcement) {
  editingId.value = item.id
  title.value = item.title
  content.value = item.content
  error.value = ''
}

async function submitAnnouncement() {
  if (!title.value.trim()) {
    error.value = '请输入公告标题'
    return
  }
  if (!content.value.trim()) {
    error.value = '请输入公告内容'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = { title: title.value.trim(), content: content.value.trim() }
    const { data } = editingId.value
      ? await api.put(`/api/admin/announcements/${editingId.value}`, payload, { skipErrorToast: true } as any)
      : await api.post('/api/admin/announcements', payload, { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      announcements.value = Array.isArray(data.data.announcements) ? data.data.announcements : []
      resetForm()
    }
    else {
      error.value = getApiErrorMessage(data, '保存公告失败')
    }
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '保存公告失败')
  }
  finally {
    saving.value = false
  }
}

function askDelete(item: Announcement) {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target)
    return
  deleteLoading.value = true
  try {
    const { data } = await api.delete(`/api/admin/announcements/${target.id}`, { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      announcements.value = Array.isArray(data.data.announcements) ? data.data.announcements : []
      if (editingId.value === target.id)
        resetForm()
      showDeleteConfirm.value = false
      deleteTarget.value = null
    }
    else {
      error.value = getApiErrorMessage(data, '删除公告失败')
    }
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '删除公告失败')
  }
  finally {
    deleteLoading.value = false
  }
}

onMounted(() => {
  void fetchAnnouncements()
})
</script>

<template>
  <div class="space-y-4">
    <!-- 发布 / 编辑 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400">
          <span class="i-carbon-bullhorn text-xl" />
        </div>
        <div class="min-w-0">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            {{ editingId ? '编辑公告' : '发布公告' }}
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            发布后所有用户顶栏可见，新公告带红点提醒，用户打开后红点消失
          </p>
        </div>
      </div>

      <div class="space-y-3">
        <BaseInput
          v-model="title"
          label="公告标题"
          placeholder="请输入公告标题（最多 60 字）"
          :maxlength="60"
          class="farm-input"
        />
        <BaseTextarea
          v-model="content"
          label="公告内容"
          placeholder="请输入公告内容（最多 2000 字）"
          :rows="5"
          :maxlength="2000"
          class="farm-input"
        />
        <p v-if="error" class="text-sm text-red-500">
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <BaseButton v-if="editingId" variant="outline" size="sm" @click="resetForm">
            取消编辑
          </BaseButton>
          <BaseButton variant="primary" size="sm" :loading="saving" @click="submitAnnouncement">
            <span :class="editingId ? 'i-carbon-save' : 'i-carbon-send-alt'" class="mr-1" />
            {{ editingId ? '保存修改' : '发布' }}
          </BaseButton>
        </div>
      </div>
    </section>

    <!-- 公告列表 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
          已发布公告（{{ announcements.length }}）
        </h4>
        <BaseButton variant="secondary" size="sm" :loading="loading" @click="() => { void fetchAnnouncements() }">
          <span class="i-carbon-renew mr-1" />
          刷新
        </BaseButton>
      </div>

      <div v-if="!loading && announcements.length === 0" class="rounded-xl p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        还没有公告，发布第一条系统公告吧
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="item in announcements"
          :key="item.id"
          class="border border-gray-100 rounded-xl p-3 dark:border-gray-700"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-bold">{{ item.title }}</span>
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                  发布时间 {{ fmtTime(item.createdAt) }}
                </span>
                <span v-if="item.updatedAt > item.createdAt" class="text-[10px] text-gray-400 dark:text-gray-500">
                  编辑于 {{ fmtTime(item.updatedAt) }}
                </span>
              </div>
              <p class="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                {{ item.content }}
              </p>
            </div>
            <div class="flex flex-none items-center gap-1.5">
              <BaseButton variant="outline" size="sm" @click="startEdit(item)">
                编辑
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                class="text-red-500 dark:text-red-400"
                title="删除该公告"
                @click="askDelete(item)"
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
      title="删除公告"
      :message="deleteTarget ? `确定要删除公告「${deleteTarget.title}」吗？删除后用户端立即不可见，此操作不可恢复！` : ''"
      confirm-text="删除"
      type="danger"
      @close="!deleteLoading && (showDeleteConfirm = false)"
      @cancel="!deleteLoading && (showDeleteConfirm = false)"
      @confirm="confirmDelete"
    />
  </div>
</template>
