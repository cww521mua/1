<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const toast = useToastStore()
const userStore = useUserStore()

// ==================== 账户信息 ====================
const card = computed(() => userStore.userInfo?.card)
const expiryText = computed(() => {
  const expiresAt = card.value?.expiresAt
  if (card.value?.isPermanent || expiresAt === null)
    return '永久有效'
  if (!expiresAt)
    return '-'
  const remainMs = expiresAt - Date.now()
  if (remainMs <= 0)
    return '已到期，续费后可恢复登录'
  const remainDays = Math.ceil(remainMs / 86400000)
  return `${new Date(expiresAt).toLocaleString('zh-CN')}（剩 ${remainDays} 天）`
})

// ==================== 卡密续费 ====================
const renewCode = ref('')
const renewLoading = ref(false)

async function handleRenew() {
  if (!renewCode.value.trim()) {
    toast.warning('请输入卡密')
    return
  }
  renewLoading.value = true
  try {
    const result = await userStore.renew(renewCode.value.trim().toUpperCase())
    if (result.ok) {
      toast.success('续费成功')
      renewCode.value = ''
    }
    else if (result.error) {
      toast.error(result.error)
    }
  }
  finally {
    renewLoading.value = false
  }
}

// ==================== 修改密码 ====================
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordLoading = ref(false)

async function handleChangePassword() {
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) {
    toast.warning('请填写完整的密码信息')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    toast.warning('两次输入的新密码不一致')
    return
  }
  passwordLoading.value = true
  try {
    const result = await userStore.changePassword(oldPassword.value, newPassword.value)
    if (result.ok) {
      toast.success('密码修改成功，请重新登录')
      oldPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      setTimeout(() => {
        window.location.href = '/login'
      }, 1000)
    }
    else if (result.error) {
      toast.error(result.error)
    }
  }
  finally {
    passwordLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
      账户中心
    </h3>

    <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <!-- 卡密续费 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
            <span class="i-carbon-ticket text-xl" />
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              卡密续费
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              当前有效期：{{ expiryText }} · 账号上限 {{ userStore.accountLimit }}
            </p>
          </div>
        </div>

        <div class="space-y-3">
          <BaseInput
            v-model="renewCode"
            type="text"
            label="卡密"
            placeholder="输入时间卡密续期，或额度卡密提升账号上限"
          />
          <div class="flex justify-end">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="renewLoading"
              @click="handleRenew"
            >
              核销续费
            </BaseButton>
          </div>
        </div>
      </section>

      <!-- 修改密码 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400">
            <span class="i-carbon-password text-xl" />
          </div>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              修改密码
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              修改成功后需要重新登录
            </p>
          </div>
        </div>

        <div class="space-y-3">
          <BaseInput
            v-model="oldPassword"
            type="password"
            label="当前密码"
            autocomplete="current-password"
          />
          <BaseInput
            v-model="newPassword"
            type="password"
            label="新密码"
            placeholder="至少6位，含两种字符类型"
            autocomplete="new-password"
          />
          <BaseInput
            v-model="confirmPassword"
            type="password"
            label="确认新密码"
            autocomplete="new-password"
          />
          <div class="flex justify-end">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="passwordLoading"
              @click="handleChangePassword"
            >
              修改密码
            </BaseButton>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
