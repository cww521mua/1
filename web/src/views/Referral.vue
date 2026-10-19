<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { copyTextToClipboard } from '@/stores/card'
import api from '@/api'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

interface ReferredUser {
  username: string
  createdAt: number
  validPurchase: boolean
  validPurchaseAt: number | null
  expired: boolean
  enabled: boolean
}

interface ReferralOverview {
  referralCode: string
  referred: ReferredUser[]
  validCount: number
  agentRequired: number
  isAgent: boolean
  qualifyCardDays: number
  rewardDays: number
}

const toast = useToastStore()
const userStore = useUserStore()

const loading = ref(false)
const overview = ref<ReferralOverview | null>(null)
const copied = ref<'code' | 'link' | ''>('')

const isUser = computed(() => userStore.role === 'user')

const referralLink = computed(() => {
  if (!overview.value?.referralCode)
    return ''
  return `${window.location.origin}/register?ref=${overview.value.referralCode}`
})

const agentProgress = computed(() => {
  if (!overview.value)
    return 0
  return Math.min(100, Math.round((overview.value.validCount / overview.value.agentRequired) * 100))
})

const remainingToAgent = computed(() => {
  if (!overview.value)
    return 0
  return Math.max(0, overview.value.agentRequired - overview.value.validCount)
})

async function loadReferral() {
  loading.value = true
  try {
    const { data } = await api.get('/api/user/referral', { skipErrorToast: true } as any)
    if (data?.ok)
      overview.value = data.data
  }
  catch {
    // 管理员或接口异常时静默，页面显示提示
  }
  finally {
    loading.value = false
  }
}

async function handleCopy(kind: 'code' | 'link') {
  const text = kind === 'code' ? overview.value?.referralCode || '' : referralLink.value
  if (!text)
    return
  try {
    await copyTextToClipboard(text)
    copied.value = kind
    toast.success(kind === 'code' ? '推广码已复制' : '推广链接已复制')
    setTimeout(() => {
      copied.value = ''
    }, 1500)
  }
  catch {
    toast.error('复制失败，请手动复制')
  }
}

function formatDate(ts: number | null | undefined) {
  if (!ts)
    return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

onMounted(loadReferral)
</script>

<template>
  <div class="page-stack">
    <div class="settings-content space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
            推广计划
          </h3>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            分享专属链接，好友免卡密注册并获得 1 小时体验；TA 使用 30 天及以上卡密注册或续费后，你获得 5 天奖励，TA 额外获得 2 天奖励
          </p>
        </div>
      </div>

      <div v-if="!isUser">
        <EmptyState
          title="推广功能面向普通用户"
          description="普通用户登录后，可在本页查看推广码、被推广人与代理进度"
          icon="i-carbon-connect"
        />
      </div>

      <template v-else>
        <div v-if="loading && !overview" class="py-8 text-center text-gray-500">
          <span class="i-carbon-circle-dash mb-2 inline-block animate-spin text-2xl" />
          <div>加载中...</div>
        </div>

        <template v-else-if="overview">
          <!-- 代理状态 -->
          <section class="farm-card flex items-start gap-3 rounded-lg p-4">
            <div
              class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg"
              :class="overview.isAgent ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'"
            >
              <span :class="overview.isAgent ? 'i-carbon-star-filled' : 'i-carbon-star'" class="text-xl" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                  {{ overview.isAgent ? '代理身份已生效' : '代理进度' }}
                </h4>
                <span
                  v-if="overview.isAgent"
                  class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-amber-600 dark:bg-amber-900/25 dark:text-amber-400"
                >
                  代理 · 7 折拿卡
                </span>
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                <template v-if="overview.isAgent">
                  已达成 {{ overview.validCount }} 个有效推广，联系管理员以代理价拿卡
                </template>
                <template v-else>
                  有效推广 {{ overview.validCount }}/{{ overview.agentRequired }}，还差
                  {{ remainingToAgent }} 人成为代理（享受 7 折拿卡优惠）
                </template>
              </p>
              <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{ width: `${agentProgress}%`, backgroundColor: 'var(--theme-primary)' }"
                />
              </div>
            </div>
          </section>

          <!-- 推广码与链接 -->
          <section class="farm-card rounded-lg p-4">
            <div class="mb-4 flex items-start gap-3">
              <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
                <span class="i-carbon-qr-code text-xl" />
              </div>
              <div class="min-w-0 flex-1">
                <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                  我的推广
                </h4>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  通过链接注册的账号免卡密，赠送 1 小时体验；每个网络仅可注册一个
                </p>
              </div>
            </div>

            <div class="space-y-3">
              <div class="flex flex-col gap-2 border border-gray-200 rounded-lg bg-gray-50/70 p-3 sm:flex-row sm:items-center dark:border-gray-700 dark:bg-gray-900/30">
                <div class="min-w-0 flex-1">
                  <label class="text-xs text-gray-500 dark:text-gray-400">推广码</label>
                  <p class="font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-gray-100">
                    {{ overview.referralCode }}
                  </p>
                </div>
                <BaseButton variant="secondary" size="sm" @click="handleCopy('code')">
                  <span :class="copied === 'code' ? 'i-carbon-checkmark' : 'i-carbon-copy'" class="mr-1" />
                  {{ copied === 'code' ? '已复制' : '复制' }}
                </BaseButton>
              </div>

              <div class="flex flex-col gap-2 border border-gray-200 rounded-lg bg-gray-50/70 p-3 sm:flex-row sm:items-center dark:border-gray-700 dark:bg-gray-900/30">
                <div class="min-w-0 flex-1">
                  <label class="text-xs text-gray-500 dark:text-gray-400">推广链接</label>
                  <p class="truncate font-mono text-sm text-gray-900 dark:text-gray-100">
                    {{ referralLink }}
                  </p>
                </div>
                <BaseButton variant="primary" size="sm" @click="handleCopy('link')">
                  <span :class="copied === 'link' ? 'i-carbon-checkmark' : 'i-carbon-copy'" class="mr-1" />
                  {{ copied === 'link' ? '已复制' : '复制链接' }}
                </BaseButton>
              </div>
            </div>
          </section>

          <!-- 被推广人列表 -->
          <section class="farm-card rounded-lg p-4">
            <div class="mb-4 flex items-start gap-3">
              <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
                <span class="i-carbon-user-multiple text-xl" />
              </div>
              <div class="min-w-0 flex-1">
                <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                  绑定的被推广人（{{ overview.referred.length }}）
                </h4>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  有效购买 = 被推广人使用 {{ overview.qualifyCardDays }} 天及以上卡密续费，每次续费你都会获得 {{ overview.rewardDays }} 天奖励
                </p>
              </div>
            </div>

            <div v-if="overview.referred.length === 0">
              <EmptyState
                bare
                title="还没有绑定被推广人"
                description="复制上方推广链接分享出去，好友注册后自动绑定到这里"
                icon="i-carbon-user-follow"
              />
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="item in overview.referred"
                :key="item.username"
                class="flex flex-col gap-2 border border-gray-100 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-sm font-bold text-gray-900 dark:text-gray-100">{{ item.username }}</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                      :class="item.validPurchase
                        ? 'bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
                    >
                      {{ item.validPurchase ? '已有效购买' : '未购买' }}
                    </span>
                    <span
                      v-if="!item.enabled"
                      class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-red-500 dark:bg-red-900/25 dark:text-red-400"
                    >
                      已停用
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    注册于 {{ formatDate(item.createdAt) }}
                    <template v-if="item.validPurchaseAt">
                      · 购买于 {{ formatDate(item.validPurchaseAt) }}
                    </template>
                  </p>
                </div>
              </div>
            </div>
          </section>

          <!-- 规则说明 -->
          <section class="farm-card rounded-lg p-4">
            <div class="mb-3 flex items-start gap-3">
              <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-400">
                <span class="i-carbon-information text-xl" />
              </div>
              <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
                推广规则
              </h4>
            </div>
            <ol class="list-decimal space-y-1.5 pl-5 text-xs text-gray-500 leading-relaxed dark:text-gray-400">
              <li>好友通过你的推广链接注册，无需卡密，注册即获得 1 小时体验时长。</li>
              <li>每个网络（IP）仅可通过推广链接注册一个账号。</li>
              <li>被推广人使用 30 天及以上（含永久）卡密注册或续费，即计为一次有效购买。</li>
              <li>被推广人使用 30 天及以上卡密注册或续费时，本人额外获得 2 天时长奖励。</li>
              <li>被推广人每次有效购买，你的账号自动续 5 天，多次购买多次奖励。</li>
              <li>有效推广累计 {{ overview.agentRequired }} 人自动成为代理，享受 7 折拿卡优惠，请联系管理员兑换。</li>
            </ol>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>
