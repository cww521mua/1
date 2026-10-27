<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

/**
 * 视频教程管理（管理员）：维护教程视频的名称与播放链接。
 * 视频文件托管在外部视频服务（如 .224 上传服务），此处保存可播放的链接；
 * 用户在主页「视频教程」进入的公开教程页播放。
 */

interface VideoTutorial {
  id: string
  title: string
  url: string
  createdAt: number
}

const videos = ref<VideoTutorial[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const editingId = ref('')
const title = ref('')
const url = ref('')

const showDeleteConfirm = ref(false)
const deleteTarget = ref<VideoTutorial | null>(null)
const deleteLoading = ref(false)

async function fetchVideos() {
  loading.value = true
  try {
    const { data } = await api.get('/api/admin/video-tutorials', { skipErrorToast: true } as any)
    if (data?.ok && data.data)
      videos.value = Array.isArray(data.data.videos) ? data.data.videos : []
    else
      error.value = getApiErrorMessage(data, '获取视频列表失败')
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '获取视频列表失败')
  }
  finally {
    loading.value = false
  }
}

function resetForm() {
  editingId.value = ''
  title.value = ''
  url.value = ''
}

function startEdit(item: VideoTutorial) {
  editingId.value = item.id
  title.value = item.title
  url.value = item.url
  error.value = ''
}

async function submitVideo() {
  if (!title.value.trim()) {
    error.value = '请输入视频名称'
    return
  }
  if (!url.value.trim()) {
    error.value = '请输入视频链接'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = { title: title.value.trim(), url: url.value.trim() }
    const { data } = editingId.value
      ? await api.put(`/api/admin/video-tutorials/${editingId.value}`, payload, { skipErrorToast: true } as any)
      : await api.post('/api/admin/video-tutorials', payload, { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      videos.value = Array.isArray(data.data.videos) ? data.data.videos : []
      resetForm()
    }
    else {
      error.value = getApiErrorMessage(data, '保存视频失败')
    }
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '保存视频失败')
  }
  finally {
    saving.value = false
  }
}

function askDelete(item: VideoTutorial) {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target)
    return
  deleteLoading.value = true
  try {
    const { data } = await api.delete(`/api/admin/video-tutorials/${target.id}`, { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      videos.value = Array.isArray(data.data.videos) ? data.data.videos : []
      if (editingId.value === target.id)
        resetForm()
      showDeleteConfirm.value = false
      deleteTarget.value = null
    }
    else {
      error.value = getApiErrorMessage(data, '删除视频失败')
    }
  }
  catch (e: any) {
    error.value = getApiErrorMessage(e, '删除视频失败')
  }
  finally {
    deleteLoading.value = false
  }
}

onMounted(() => {
  void fetchVideos()
})
</script>

<template>
  <div class="space-y-4">
    <!-- 新增 / 编辑 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400">
          <span class="i-carbon-video text-xl" />
        </div>
        <div class="min-w-0">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            {{ editingId ? '编辑视频' : '添加视频教程' }}
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            填入视频服务的播放链接（如 http://140.210.9.224:8890/videos/xxx.mp4），保存后用户即可在主页「视频教程」播放
          </p>
        </div>
      </div>

      <div class="space-y-3">
        <BaseInput
          v-model="title"
          label="视频名称"
          type="text"
          placeholder="请输入视频名称（最多 60 字）"
          class="farm-input"
        />
        <BaseInput
          v-model="url"
          label="视频链接"
          type="text"
          placeholder="http://140.210.9.224:8890/videos/xxx.mp4"
          class="farm-input"
        />
        <p v-if="error" class="text-sm text-red-500">
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <BaseButton v-if="editingId" variant="outline" size="sm" @click="resetForm">
            取消编辑
          </BaseButton>
          <BaseButton variant="primary" size="sm" :loading="saving" @click="submitVideo">
            <span :class="editingId ? 'i-carbon-save' : 'i-carbon-add'" class="mr-1" />
            {{ editingId ? '保存修改' : '添加' }}
          </BaseButton>
        </div>
      </div>
    </section>

    <!-- 视频列表 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
          已添加视频（{{ videos.length }}）
        </h4>
        <BaseButton variant="secondary" size="sm" :loading="loading" @click="() => { void fetchVideos() }">
          <span class="i-carbon-renew mr-1" />
          刷新
        </BaseButton>
      </div>

      <div v-if="!loading && videos.length === 0" class="rounded-xl p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        还没有视频教程，先在上方添加一个
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="(item, index) in videos"
          :key="item.id"
          class="border border-gray-100 rounded-xl p-3 dark:border-gray-700"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                  {{ index + 1 }}
                </span>
                <span class="text-sm font-bold">{{ item.title }}</span>
              </div>
              <p class="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
                {{ item.url }}
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
                title="删除该视频"
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
      title="删除视频"
      :message="deleteTarget ? `确定要删除视频「${deleteTarget.title}」吗？删除后用户端立即不可见，此操作不可恢复！` : ''"
      confirm-text="删除"
      type="danger"
      @close="!deleteLoading && (showDeleteConfirm = false)"
      @cancel="!deleteLoading && (showDeleteConfirm = false)"
      @confirm="confirmDelete"
    />
  </div>
</template>
