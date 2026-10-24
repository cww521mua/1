<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BrandMark from '@/components/ui/BrandMark.vue'
import { useBrandStore } from '@/stores/brand'
import { useUserStore } from '@/stores/user'

// embedded: 在主页登录弹窗内使用（去掉整页背景与滚动，仅渲染玻璃卡片）
const props = defineProps<{
  embedded?: boolean
  initialMode?: 'login' | 'register'
}>()

const userStore = useUserStore()
const brandStore = useBrandStore()
const brand = computed(() => brandStore.brand)
const route = useRoute()
const mode = ref<'login' | 'register'>(props.initialMode === 'register' ? 'register' : 'login')
const registerVia = ref<'card' | 'referral' | 'trial'>('card')
const trialStatus = ref<{ enabled: boolean, remaining: number }>({ enabled: false, remaining: 0 })
const refInfo = ref<{ username: string, isAgent: boolean } | null>(null)
const refInput = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const cardCode = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

const passwordValid = computed(() => {
  const pwd = password.value
  if (!pwd)
    return { valid: false, message: '' }
  if (pwd.length < 6)
    return { valid: false, message: '密码长度至少6位' }
  let typeCount = 0
  if (/[a-z]/.test(pwd))
    typeCount++
  if (/[A-Z]/.test(pwd))
    typeCount++
  if (/\d/.test(pwd))
    typeCount++
  if (/[^a-zA-Z0-9]/.test(pwd))
    typeCount++
  if (typeCount < 2)
    return { valid: false, message: '密码需包含大小写字母、数字、特殊符号中的至少两种' }
  return { valid: true, message: '' }
})

const confirmPasswordValid = computed(() => {
  if (!confirmPassword.value)
    return { valid: false, message: '' }
  if (confirmPassword.value !== password.value)
    return { valid: false, message: '两次输入的密码不一致' }
  return { valid: true, message: '' }
})

const cardCodeValid = computed(() => {
  const code = cardCode.value.trim().toUpperCase()
  if (!code)
    return { valid: true, message: '' }
  if (!/^[A-Z0-9]{16}$/.test(code))
    return { valid: false, message: '卡密为 16 位大写字母或数字' }
  return { valid: true, message: '' }
})

const refCodeValid = computed(() => {
  const code = refInput.value.trim().toUpperCase()
  if (!code || registerVia.value !== 'card')
    return { valid: true, message: '' }
  if (!/^[A-Z0-9]{8}$/.test(code))
    return { valid: false, message: '推广码为 8 位大写字母或数字' }
  return { valid: true, message: '' }
})

// 注册页试用入口：开关开启且还有未使用的试用卡时显示
const trialAvailable = computed(() => trialStatus.value.enabled && trialStatus.value.remaining > 0)

async function fetchTrialStatus() {
  trialStatus.value = await userStore.fetchTrialStatus()
}

function switchVia(next: 'card' | 'trial') {
  registerVia.value = next
  error.value = ''
  success.value = ''
}

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }
  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }
  if (!password.value) {
    error.value = '请输入密码'
    return false
  }
  if (mode.value === 'register') {
    if (!passwordValid.value.valid) {
      error.value = passwordValid.value.message
      return false
    }
    if (!confirmPasswordValid.value.valid) {
      error.value = confirmPasswordValid.value.message || '请再次输入密码'
      return false
    }
    if (registerVia.value === 'card') {
      if (!cardCodeValid.value.valid) {
        error.value = cardCodeValid.value.message
        return false
      }
      if (!cardCode.value.trim()) {
        error.value = '请输入卡密'
        return false
      }
    }
    if (!refCodeValid.value.valid) {
      error.value = refCodeValid.value.message
      return false
    }
  }
  return true
}

function switchMode(next: 'login' | 'register') {
  mode.value = next
  error.value = ''
  success.value = ''
  password.value = ''
  confirmPassword.value = ''
  if (next === 'register') {
    if (!route.query.ref) {
      registerVia.value = 'card'
      refInput.value = ''
    }
    void fetchTrialStatus()
  }
  else {
    refInput.value = ''
    refInfo.value = null
  }
}

async function applyReferralFromQuery() {
  const code = String(route.query.ref || '').trim()
  if (!code) {
    registerVia.value = 'card'
    refInfo.value = null
    return
  }
  mode.value = 'register'
  registerVia.value = 'referral'
  refInput.value = code.toUpperCase()
  refInfo.value = await userStore.fetchReferralInfo(code.toUpperCase())
  if (!refInfo.value) {
    error.value = '推广链接无效，请使用卡密注册'
    registerVia.value = 'card'
    refInput.value = ''
  }
}

watch(() => route.query.ref, () => {
  if (route.query.ref !== undefined)
    void applyReferralFromQuery()
})

async function handleSubmit() {
  if (!validateForm())
    return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (mode.value === 'register' && registerVia.value === 'referral') {
      const result = await userStore.registerReferral(username.value.trim(), password.value, String(route.query.ref || '').trim().toUpperCase())
      if (result.ok) {
        success.value = '注册成功，体验时长已到账，请登录'
        password.value = ''
        confirmPassword.value = ''
        setTimeout(() => {
          mode.value = 'login'
          success.value = ''
        }, 1200)
      }
      else {
        error.value = result.error || '注册失败'
      }
      return
    }

    if (mode.value === 'register' && registerVia.value === 'trial') {
      const result = await userStore.registerTrial(username.value.trim(), password.value)
      if (result.ok) {
        success.value = '试用领取成功，已获得 1 小时体验，请登录'
        password.value = ''
        confirmPassword.value = ''
        setTimeout(() => {
          mode.value = 'login'
          registerVia.value = 'card'
          success.value = ''
        }, 1600)
      }
      else {
        error.value = result.error || '领取失败'
      }
      void fetchTrialStatus()
      return
    }

    if (mode.value === 'register') {
      const result = await userStore.register(
        username.value.trim(),
        password.value,
        cardCode.value.trim().toUpperCase(),
        refInput.value.trim().toUpperCase() || undefined,
      )
      if (result.ok) {
        success.value = '注册成功，请登录'
        password.value = ''
        confirmPassword.value = ''
        cardCode.value = ''
        setTimeout(() => {
          mode.value = 'login'
          success.value = ''
        }, 1200)
      }
      else {
        error.value = result.error || '注册失败'
      }
      return
    }

    const result = await userStore.login(username.value, password.value)
    if (result.ok) {
      if (result.data?.mustChangePassword)
        success.value = '登录成功，请修改默认密码'
      setTimeout(() => {
        // 登录成功直接进入面板（概览页）
        window.location.href = '/dashboard'
      }, 500)
    }
    else if (result.errorType === 'rate_limit') {
      error.value = result.error || '请求过于频繁，请稍后重试'
      if (result.remainingMs)
        rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
    }
    else if (result.errorType === 'locked') {
      error.value = result.error || '账户已被锁定'
      if (result.remainingMs)
        lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
    }
    else {
      error.value = result.error || '登录失败'
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = getApiErrorMessage(data, '请求过于频繁')
      if (data.remainingMs)
        rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
    }
    else if (data?.errorType === 'locked') {
      error.value = getApiErrorMessage(data, '账户已被锁定')
      if (data.remainingMs)
        lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
    }
    else {
      error.value = getApiErrorMessage(e, '操作异常')
    }
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void applyReferralFromQuery()
  void fetchTrialStatus()
  void brandStore.load()
})
</script>

<template>
  <main class="login-container" :class="{ embedded: props.embedded }">
    <section class="login-card">
      <header class="logo-area">
        <img v-if="brand.icon" :src="brand.icon" alt="logo" class="logo-icon logo-icon-img">
        <BrandMark v-else class="logo-icon" :size="58" />
        <div>
          <span v-if="brand.kicker" class="logo-kicker">{{ brand.kicker }}</span>
          <h1 class="logo-title">
            {{ brand.title }}
          </h1>
        </div>
      </header>

      <form class="form-area" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label class="form-label" for="username">
            <span class="i-carbon-user" />
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            autocomplete="username"
            required
          />
          <p v-if="username && !usernameValid.valid" class="form-hint error">
            {{ usernameValid.message }}
          </p>
        </div>

        <div
          v-if="mode === 'register' && registerVia === 'referral'"
          class="message success-message"
          role="status"
        >
          <span class="i-carbon-user-follow" />
          <div>
            邀请人：<strong>{{ refInfo?.username || '-' }}</strong>
            <template v-if="refInfo?.isAgent">（代理）</template>
            <br>注册即赠送 1 小时体验，使用 30 天及以上卡密续费后邀请人获得奖励
          </div>
        </div>

        <div
          v-if="mode === 'register' && registerVia === 'trial'"
          class="message success-message"
          role="status"
        >
          <span class="i-carbon-idea" />
          <div>
            <strong>试用注册</strong>：免费领取 1 小时体验时长，每个 IP 仅限领取一次
            <br>
            <button type="button" class="trial-back-link" @click="switchVia('card')">
              使用卡密注册，获得更多时长 →
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="password">
            <span class="i-carbon-locked" />
            密码
          </label>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            :placeholder="mode === 'register' ? '至少6位，含两种字符类型' : '请输入密码'"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            required
          />
          <p v-if="mode === 'register' && password && !passwordValid.valid" class="form-hint error">
            {{ passwordValid.message }}
          </p>
        </div>

        <template v-if="mode === 'register'">
          <div class="form-group">
            <label class="form-label" for="confirm-password">
              <span class="i-carbon-locked" />
              确认密码
            </label>
            <BaseInput
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              autocomplete="new-password"
              required
            />
            <p v-if="confirmPassword && !confirmPasswordValid.valid" class="form-hint error">
              {{ confirmPasswordValid.message }}
            </p>
          </div>

          <div v-if="registerVia === 'card'" class="form-group">
            <label class="form-label" for="card-code">
              <span class="i-carbon-ticket" />
              卡密
            </label>
            <BaseInput
              id="card-code"
              v-model="cardCode"
              type="text"
              placeholder="请输入 16 位时间卡密"
              required
            />
            <p v-if="cardCode && !cardCodeValid.valid" class="form-hint error">
              {{ cardCodeValid.message }}
            </p>
            <a
              v-if="brand.purchaseText && brand.purchaseUrl"
              :href="brand.purchaseUrl"
              target="_blank"
              rel="noopener"
              class="purchase-link"
            >
              <span class="i-carbon-shopping-cart" />
              {{ brand.purchaseText }}
            </a>
            <button
              v-if="trialAvailable"
              type="button"
              class="trial-entry"
              @click="switchVia('trial')"
            >
              <span class="i-carbon-gift" />
              没有卡密？免费领取 1 小时试用（剩余 {{ trialStatus.remaining }} 个名额）
            </button>
          </div>

          <div v-if="registerVia !== 'card' && registerVia !== 'trial'" class="form-group">
            <label class="form-label" for="ref-code">
              <span class="i-carbon-connect" />
              推广码
            </label>
            <BaseInput
              id="ref-code"
              v-model="refInput"
              type="text"
              disabled
              placeholder="来自推广链接"
            />
          </div>

          <div v-if="registerVia === 'card'" class="form-group">
            <label class="form-label" for="ref-code">
              <span class="i-carbon-connect" />
              推广码（选填）
            </label>
            <BaseInput
              id="ref-code"
              v-model="refInput"
              type="text"
              placeholder="填写邀请人的推广码，可不填"
            />
            <p v-if="refInput && !refCodeValid.valid" class="form-hint error">
              {{ refCodeValid.message }}
            </p>
            <p class="form-hint">
              填写推广码并使用 30 天及以上卡密注册，你会额外获得 2 天时长，邀请人获得 5 天时长
            </p>
          </div>
        </template>

        <div v-if="error" class="message error-message" role="alert">
          <span class="i-carbon-warning-alt" />
          <div>
            {{ error }}
            <span v-if="lockoutRemaining > 0">（{{ lockoutRemaining }} 分钟后解锁）</span>
            <span v-if="rateLimitRemaining > 0">（{{ rateLimitRemaining }} 秒后可重试）</span>
          </div>
        </div>
        <div v-if="success" class="message success-message" role="status">
          <span class="i-carbon-checkmark-filled" />
          {{ success }}
        </div>

        <BaseButton type="submit" variant="primary" block :loading="loading" class="submit-btn">
          <span v-if="!loading" class="inline-flex items-center gap-2">
            <span :class="mode === 'login' ? 'i-carbon-login' : registerVia === 'trial' ? 'i-carbon-gift' : 'i-carbon-user-follow'" />
            {{ mode === 'login' ? '登录' : registerVia === 'trial' ? '领取试用并注册' : '注册' }}
          </span>
        </BaseButton>
      </form>

      <div class="mode-switch">
        <button
          type="button"
          class="mode-switch__link"
          @click="switchMode(mode === 'login' ? 'register' : 'login')"
        >
          <span :class="mode === 'login' ? 'i-carbon-user-follow' : 'i-carbon-login'" />
          {{ mode === 'login' ? '没有账号？使用卡密注册' : '已有账号？返回登录' }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-container {
  position: relative;
  display: flex;
  width: 100%;
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 28px 18px;
  color: var(--ui-ink);
  background-color: var(--ui-bg);
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
}

/* 弹窗内嵌模式：仅保留玻璃卡片本身 */
.login-container.embedded {
  height: auto;
  max-height: min(78dvh, 720px);
  padding: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: none;
}

.login-container.embedded::before {
  display: none;
}

.login-container.embedded .login-card {
  width: 100%;
  margin: 0 auto;
  background: color-mix(in srgb, var(--ui-bg) 90%, transparent);
}

.login-container::before {
  position: absolute;
  inset: 8% 7%;
  border: 1px solid rgba(67, 141, 99, 0.08);
  border-radius: 36px;
  background: color-mix(in srgb, var(--ui-surface-strong) 22%, transparent);
  content: '';
}

.login-card {
  position: relative;
  z-index: 1;
  width: min(430px, 100%);
  margin: auto;
  padding: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-bg) 82%, transparent);
  box-shadow:
    0 28px 76px rgba(55, 75, 61, 0.16),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--ui-border);
}

.logo-icon {
  flex: none;
  filter: drop-shadow(0 8px 18px rgba(45, 122, 83, 0.24));
}

.logo-icon-img {
  width: 58px;
  height: 58px;
  border-radius: 14px;
  object-fit: cover;
  filter: none;
  box-shadow: 0 8px 18px rgba(45, 122, 83, 0.18);
}

.logo-kicker {
  display: block;
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 700;
}

.logo-title {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 0;
}

.form-area {
  display: flex;
  flex-direction: column;
  gap: 17px;
  padding-top: 24px;
}

.form-group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.form-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: 600;
}

.form-label > span {
  color: var(--ui-primary);
}

.login-card :deep(.base-input) {
  height: 42px;
  border-color: var(--ui-border);
  border-radius: 10px;
  color: var(--ui-ink);
  background: color-mix(in srgb, var(--ui-surface-strong) 70%, transparent);
}

.login-card :deep(.base-input:focus) {
  border-color: rgba(67, 141, 99, 0.55);
  box-shadow: 0 0 0 3px rgba(67, 141, 99, 0.1);
}

.form-hint {
  margin: 0;
  color: var(--ui-danger);
  font-size: 11px;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.error-message {
  border-color: rgba(201, 95, 102, 0.18);
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.success-message {
  border-color: rgba(67, 141, 99, 0.18);
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.submit-btn {
  margin-top: 2px;
}

.mode-switch {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.mode-switch__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: none;
  border-radius: 8px;
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 600;
  background: transparent;
  cursor: pointer;
}

.mode-switch__link:hover {
  background: var(--ui-primary-soft);
}

.purchase-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  width: fit-content;
}

.purchase-link:hover {
  text-decoration: underline;
}

.trial-entry {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 0;
  border: none;
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 600;
  background: transparent;
  cursor: pointer;
}

.trial-entry:hover {
  text-decoration: underline;
}

.trial-back-link {
  margin-top: 4px;
  padding: 0;
  border: none;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 600;
  text-decoration: underline;
  background: transparent;
  cursor: pointer;
}

@media (max-width: 480px) {
  .login-container {
    align-items: flex-start;
    padding: 16px 12px;
  }

  .login-container::before {
    inset: 4%;
    border-radius: 24px;
  }

  .login-card {
    padding: 24px 20px;
    border-radius: 16px;
  }

  .logo-icon {
    width: 52px;
    height: 52px;
  }

  .logo-title {
    font-size: 19px;
  }
}
</style>
