<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NPopover } from 'naive-ui/es/popover'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api from '@/api'

/**
 * 顶栏系统公告入口：公告图标（主题切换按钮左侧），
 * 有未读新公告时显示红点，打开列表即标记已读、红点消失；列表随时可回看。
 */

interface Announcement {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

const announcements = ref<Announcement[]>([])
const readAt = ref(0)
const unreadCount = ref(0)
const loading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 60000

const hasUnread = computed(() => unreadCount.value > 0)

function fmtTime(timestamp: number) {
  if (!timestamp)
    return ''
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function fetchAnnouncements() {
  try {
    const { data } = await api.get('/api/announcements', { skipErrorToast: true } as any)
    if (data?.ok && data.data) {
      announcements.value = Array.isArray(data.data.announcements) ? data.data.announcements : []
      readAt.value = Number(data.data.readAt || 0)
      unreadCount.value = Number(data.data.unreadCount || 0)
    }
  }
  catch { /* 公告拉取失败静默，下次轮询重试 */ }
}

async function markRead() {
  if (unreadCount.value <= 0)
    return
  try {
    const { data } = await api.post('/api/announcements/read', {}, { skipErrorToast: true } as any)
    if (data?.ok) {
      readAt.value = Number(data.data?.readAt || Date.now())
      unreadCount.value = 0
    }
  }
  catch { /* 静默 */ }
}

function handlePopoverShow(show: boolean) {
  if (show)
    void fetchAnnouncements().then(() => markRead())
}

onMounted(() => {
  void fetchAnnouncements()
  pollTimer = setInterval(() => void fetchAnnouncements(), POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (pollTimer)
    clearInterval(pollTimer)
})
</script>

<template>
  <NPopover trigger="click" placement="bottom-end" :width="344" @update:show="handlePopoverShow">
    <template #trigger>
      <NButton quaternary circle title="系统公告" aria-label="查看系统公告">
        <span class="relative inline-flex">
          <span class="text-lg i-carbon-bullhorn" />
          <span
            v-if="hasUnread"
            class="absolute h-2 w-2 rounded-full bg-red-500"
            style="right: -1px; top: -1px"
          />
        </span>
      </NButton>
    </template>
    <div class="space-y-3">
      <div class="text-sm font-bold">
        系统公告
      </div>
      <div v-if="loading && !announcements.length" class="py-6 text-center text-xs opacity-60">
        加载中…
      </div>
      <div v-else-if="!announcements.length" class="py-6 text-center text-xs opacity-60">
        暂无公告
      </div>
      <div v-else class="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
        <div
          v-for="item in announcements"
          :key="item.id"
          class="rounded-xl p-3"
          style="background: rgba(127, 127, 127, 0.08)"
        >
          <div class="flex items-start justify-between gap-2">
            <span class="text-sm font-bold leading-snug">{{ item.title }}</span>
            <span
              v-if="item.createdAt > readAt"
              class="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-white"
            >
              新
            </span>
          </div>
          <p class="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed opacity-80">
            {{ item.content }}
          </p>
          <p class="mt-1.5 text-[10px] opacity-50">
            发布时间 {{ fmtTime(item.createdAt) }}
          </p>
        </div>
      </div>
    </div>
  </NPopover>
</template>
