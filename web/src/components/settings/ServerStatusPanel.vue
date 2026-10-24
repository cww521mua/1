<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

interface ServerStatus {
  version: string
  nodeVersion: string
  platform: string
  hostname: string
  processUptimeMs: number
  systemUptimeSec: number
  startedAt: number
  cpu: { percent: number | null, cores: number, model: string, loadavg: number[] }
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
    systemTotal: number
    systemUsed: number
    systemUsedPercent: number
  }
  accounts: { total: number, running: number }
  users: number
  time: number
}

const status = ref<ServerStatus | null>(null)
const loading = ref(false)
const error = ref('')
let timer: ReturnType<typeof setInterval> | null = null

const REFRESH_INTERVAL_MS = 5000

async function fetchStatus(silent = true) {
  if (!silent)
    loading.value = true
  try {
    const { data } = await api.get('/api/admin/server-status')
    if (data?.ok && data.data) {
      status.value = data.data
      error.value = ''
    }
    else {
      error.value = getApiErrorMessage(data, '获取服务器状态失败')
    }
  }
  catch (err: any) {
    error.value = getApiErrorMessage(err, '获取服务器状态失败')
  }
  finally {
    loading.value = false
  }
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0)
  if (value >= 1024 ** 3)
    return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2)
    return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024).toFixed(0)} KB`
}

function formatUptime(ms: number | null | undefined) {
  let seconds = Math.max(Math.floor(Number(ms || 0) / 1000), 0)
  const days = Math.floor(seconds / 86400)
  seconds -= days * 86400
  const hours = Math.floor(seconds / 3600)
  seconds -= hours * 3600
  const minutes = Math.floor(seconds / 60)
  if (days > 0)
    return `${days} 天 ${hours} 小时`
  if (hours > 0)
    return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分 ${seconds - minutes * 60} 秒`
}

function formatTime(timestamp: number | null | undefined) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatPercent(percent: number | null | undefined) {
  return percent === null || percent === undefined ? '采样中…' : `${percent}%`
}

function percentBarClass(percent: number | null | undefined) {
  const value = Number(percent || 0)
  if (value >= 85)
    return 'bg-red-500'
  if (value >= 65)
    return 'bg-amber-500'
  return 'bg-emerald-500'
}

function percentTextClass(percent: number | null | undefined) {
  const value = Number(percent || 0)
  if (value >= 85)
    return 'text-red-500 dark:text-red-400'
  if (value >= 65)
    return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

const systemMemPercent = computed(() => status.value?.memory.systemUsedPercent ?? 0)
const processMemPercent = computed(() => {
  const memory = status.value?.memory
  if (!memory || !memory.systemTotal)
    return 0
  return Math.round((memory.rss / memory.systemTotal) * 1000) / 10
})

onMounted(() => {
  void fetchStatus(false)
  timer = setInterval(() => void fetchStatus(true), REFRESH_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div class="space-y-4">
    <!-- 运行概览 -->
    <section class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400">
            <span class="i-carbon-monitor text-xl" />
          </div>
          <div class="min-w-0">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              服务器状态
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              每 5 秒自动刷新进程与系统资源使用情况
            </p>
          </div>
        </div>
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="loading"
          @click="() => { void fetchStatus(false) }"
        >
          <span class="i-carbon-renew mr-1" />
          刷新
        </BaseButton>
      </div>

      <div v-if="error && !status" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <span class="i-carbon-warning-alt mb-2 inline-block text-2xl text-amber-500" />
        <div>{{ error }}</div>
      </div>

      <div v-else-if="status" class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div class="border border-gray-100 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            运行状态
          </p>
          <p class="mt-1 flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
            <span class="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            运行中
          </p>
          <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            v{{ status.version }} · Node {{ status.nodeVersion }}
          </p>
        </div>
        <div class="border border-gray-100 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            进程运行时长
          </p>
          <p class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ formatUptime(status.processUptimeMs) }}
          </p>
          <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            启动于 {{ formatTime(status.startedAt) }}
          </p>
        </div>
        <div class="border border-gray-100 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            账号
          </p>
          <p class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ status.accounts.total }}
            <span class="text-sm text-gray-400 font-normal dark:text-gray-500">个</span>
          </p>
          <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            运行中 {{ status.accounts.running }} · 用户 {{ status.users }}
          </p>
        </div>
        <div class="border border-gray-100 rounded-xl bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            系统已运行
          </p>
          <p class="mt-1 text-lg text-gray-900 font-bold dark:text-gray-100">
            {{ formatUptime(status.systemUptimeSec * 1000) }}
          </p>
          <p class="mt-1 truncate text-[11px] text-gray-400 dark:text-gray-500" :title="status.hostname">
            {{ status.hostname }}
          </p>
        </div>
      </div>
    </section>

    <!-- 资源使用 -->
    <section v-if="status" class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
          <span class="i-carbon-analytics text-xl" />
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            资源使用
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {{ status.cpu.model || 'CPU' }} · {{ status.cpu.cores }} 核
          </p>
        </div>
      </div>

      <div class="space-y-4">
        <div>
          <div class="mb-1.5 flex items-center justify-between text-sm">
            <span class="text-gray-600 dark:text-gray-300">CPU 使用率</span>
            <span class="font-semibold" :class="percentTextClass(status.cpu.percent)">
              {{ formatPercent(status.cpu.percent) }}
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="percentBarClass(status.cpu.percent)"
              :style="{ width: `${Math.min(Number(status.cpu.percent || 0), 100)}%` }"
            />
          </div>
          <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            系统负载 {{ status.cpu.loadavg.join(' / ') }}
          </p>
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between text-sm">
            <span class="text-gray-600 dark:text-gray-300">进程内存（RSS）</span>
            <span class="font-semibold" :class="percentTextClass(processMemPercent)">
              {{ formatBytes(status.memory.rss) }} · {{ processMemPercent }}%
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              class="h-full rounded-full bg-emerald-500 transition-all duration-500"
              :style="{ width: `${Math.min(processMemPercent, 100)}%` }"
            />
          </div>
          <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            堆内存 {{ formatBytes(status.memory.heapUsed) }} / {{ formatBytes(status.memory.heapTotal) }}
          </p>
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between text-sm">
            <span class="text-gray-600 dark:text-gray-300">系统内存</span>
            <span class="font-semibold" :class="percentTextClass(systemMemPercent)">
              {{ formatBytes(status.memory.systemUsed) }} / {{ formatBytes(status.memory.systemTotal) }} · {{ systemMemPercent }}%
            </span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="percentBarClass(systemMemPercent)"
              :style="{ width: `${Math.min(systemMemPercent, 100)}%` }"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- 系统信息 -->
    <section v-if="status" class="farm-card rounded-lg p-4">
      <div class="mb-4 flex items-start gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
          <span class="i-carbon-information text-xl" />
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
            系统信息
          </h4>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            服务器环境与面板版本
          </p>
        </div>
      </div>

      <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 pb-1.5 dark:border-gray-700/60">
          <dt class="shrink-0 text-gray-500 dark:text-gray-400">
            面板版本
          </dt>
          <dd class="truncate text-right text-gray-900 font-medium dark:text-gray-100">
            v{{ status.version }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 pb-1.5 dark:border-gray-700/60">
          <dt class="shrink-0 text-gray-500 dark:text-gray-400">
            Node 版本
          </dt>
          <dd class="truncate text-right text-gray-900 font-medium dark:text-gray-100">
            {{ status.nodeVersion }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 pb-1.5 dark:border-gray-700/60">
          <dt class="shrink-0 text-gray-500 dark:text-gray-400">
            操作系统
          </dt>
          <dd class="truncate text-right text-gray-900 font-medium dark:text-gray-100">
            {{ status.platform }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 pb-1.5 dark:border-gray-700/60">
          <dt class="shrink-0 text-gray-500 dark:text-gray-400">
            主机名
          </dt>
          <dd class="truncate text-right text-gray-900 font-medium dark:text-gray-100">
            {{ status.hostname }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 pb-1.5 dark:border-gray-700/60">
          <dt class="shrink-0 text-gray-500 dark:text-gray-400">
            面板启动时间
          </dt>
          <dd class="truncate text-right text-gray-900 font-medium dark:text-gray-100">
            {{ formatTime(status.startedAt) }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 pb-1.5 dark:border-gray-700/60">
          <dt class="shrink-0 text-gray-500 dark:text-gray-400">
            系统运行时长
          </dt>
          <dd class="truncate text-right text-gray-900 font-medium dark:text-gray-100">
            {{ formatUptime(status.systemUptimeSec * 1000) }}
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
