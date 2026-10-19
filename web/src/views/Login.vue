<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BrandMark from '@/components/ui/BrandMark.vue'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const userStore = useUserStore()
const route = useRoute()
const appVersion = __APP_VERSION__
const gameVersion = ref('')
const mode = ref<'login' | 'register'>('login')
const registerVia = ref<'card' | 'referral'>('card')
const refInfo = ref<{ username: string, isAgent: boolean } | null>(null)
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
    if (registerVia.value === 'card' && !cardCode.value.trim()) {
      error.value = '请输入卡密'
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
  if (next === 'register' && !route.query.ref)
    registerVia.value = 'card'
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
  refInfo.value = await userStore.fetchReferralInfo(code.toUpperCase())
  if (!refInfo.value) {
    error.value = '推广链接无效，请使用卡密注册'
    registerVia.value = 'card'
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

    if (mode.value === 'register') {
      const result = await userStore.register(username.value.trim(), password.value, cardCode.value.trim().toUpperCase())
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
        window.location.href = '/'
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

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok)
      gameVersion.value = res.data.clientVersion
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

onMounted(() => {
  void applyReferralFromQuery()
  fetchGameVersion()
})
</script>

<template>
  <main class="login-container">
    <section class="login-card">
      <header class="logo-area">
        <BrandMark class="logo-icon" :size="58" />
        <div>
          <span class="logo-kicker">QQ FARM</span>
          <h1 class="logo-title">
            QQ农场智能助手
          </h1>
          <p class="logo-subtitle">
            {{ mode === 'login'
              ? '超级管理员 / 用户登录'
              : (registerVia === 'referral' ? '推广注册 · 1 小时免费体验' : '使用时间卡密注册账号') }}
          </p>
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
            <p class="form-hint">
              时间卡密决定账号有效期；注册后可在设置中使用额度卡密提升账号上限
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
            <span :class="mode === 'login' ? 'i-carbon-login' : 'i-carbon-user-follow'" />
            {{ mode === 'login' ? '登录' : '注册' }}
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

      <footer class="card-footer">
        <div class="footer-info">
          <span>Web v{{ appVersion }}</span>
          <span v-if="gameVersion">Game {{ gameVersion }}</span>
        </div>
        <a href="https://github.com/liyangpengs/qq-farm-bot" target="_blank" rel="noopener noreferrer" class="github-link" aria-label="GitHub">
          <span class="i-carbon-logo-github" />
        </a>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.login-container {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 100dvh;
  place-items: center;
  overflow: hidden;
  padding: 28px 18px;
  color: var(--ui-ink);
  background-color: var(--ui-bg);
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
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

.logo-kicker {
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

.logo-subtitle {
  margin: 5px 0 0;
  color: var(--ui-muted);
  font-size: 12px;
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

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22px;
  padding-top: 17px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-subtle);
  font-size: 10px;
}

.footer-info {
  display: flex;
  gap: 12px;
}

.github-link {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  color: var(--ui-muted);
  text-decoration: none;
}

.github-link:hover {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

@media (max-width: 480px) {
  .login-container {
    align-items: center;
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
