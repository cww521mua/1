import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api, { getApiErrorMessage } from '@/api'

export interface UserCard {
  code: string
  description: string
  expiresAt: number | null
  isPermanent: boolean
}

export interface UserInfo {
  username: string
  role: 'admin' | 'user'
  avatar?: string
  mustChangePassword?: boolean
  enabled?: boolean
  card?: UserCard
  accountLimit?: number
  gameAccountCount?: number
  createdAt?: number
  expired?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials' | 'disabled' | 'expired'
  remainingMs?: number
  data?: {
    token: string
    role: 'admin' | 'user'
    user: { username: string }
    mustChangePassword?: boolean
    card?: UserCard
    accountLimit?: number
  }
}

export type Role = 'admin' | 'user'

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<UserInfo | null>('user_info', null)
  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => userInfo.value?.username || '')
  const avatar = computed(() => userInfo.value?.avatar || '')
  // 用户信息缺失或异常时一律按普通用户处理，避免误调管理员专属接口
  const role = computed<Role>(() => userInfo.value?.role === 'admin' ? 'admin' : 'user')
  const isAdmin = computed(() => role.value === 'admin')
  const accountLimit = computed(() => userInfo.value?.accountLimit ?? 0)
  const cardExpiry = computed(() => userInfo.value?.card?.expiresAt ?? null)

  function applyLoginData(data: NonNullable<LoginResult['data']>) {
    token.value = data.token
    userInfo.value = {
      username: data.user.username,
      role: data.role,
      mustChangePassword: data.mustChangePassword,
      card: data.card,
      accountLimit: data.accountLimit,
    }
  }

  async function login(username: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data.ok)
        applyLoginData(res.data.data)
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      return data
        ? { ok: false, error: getApiErrorMessage(data, '网络错误'), errorType: data.errorType, remainingMs: data.remainingMs }
        : { ok: false, error: getApiErrorMessage(error, '网络错误') }
    }
  }

  async function register(username: string, password: string, cardCode: string, refCode?: string) {
    try {
      const res = await api.post('/api/register', { username, password, cardCode, refCode: refCode || undefined }, { skipErrorToast: true } as any)
      return res.data
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '注册失败') }
    }
  }

  async function registerReferral(username: string, password: string, refCode: string) {
    try {
      const res = await api.post('/api/register/referral', { username, password, refCode }, { skipErrorToast: true } as any)
      return res.data
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '注册失败') }
    }
  }

  async function renewOffline(username: string, password: string, cardCode: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/user/renew-offline', { username, password, cardCode }, { skipErrorToast: true } as any)
      if (res.data.ok && res.data.data)
        applyLoginData(res.data.data)
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      return data
        ? { ok: false, error: getApiErrorMessage(data, '续费失败'), errorType: data.errorType, remainingMs: data.remainingMs }
        : { ok: false, error: getApiErrorMessage(error, '续费失败') }
    }
  }

  async function fetchTrialStatus() {
    try {
      const res = await api.get('/api/register/trial-status', { skipErrorToast: true } as any)
      if (res.data?.ok && res.data.data)
        return { enabled: !!res.data.data.enabled, remaining: Number(res.data.data.remaining || 0) }
      return { enabled: false, remaining: 0 }
    }
    catch {
      return { enabled: false, remaining: 0 }
    }
  }

  async function registerTrial(username: string, password: string) {
    try {
      const res = await api.post('/api/register/trial', { username, password }, { skipErrorToast: true } as any)
      return res.data
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '领取失败') }
    }
  }

  async function fetchReferralInfo(code: string) {
    try {
      const res = await api.get('/api/register/referral-info', { params: { code } , skipErrorToast: true } as any)
      if (res.data?.ok)
        return res.data.data as { username: string, isAgent: boolean }
      return null
    }
    catch {
      return null
    }
  }

  async function renew(cardCode: string) {
    try {
      const res = await api.post('/api/user/renew', { cardCode }, { skipErrorToast: true } as any)
      if (res.data.ok && res.data.data) {
        userInfo.value = { ...(userInfo.value || { username: '', role: 'user' as const }), ...res.data.data }
      }
      return res.data
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '续费失败') }
    }
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok)
        userInfo.value = res.data.data
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword }, { skipErrorToast: true } as any)
    return res.data
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    username,
    avatar,
    role,
    isAdmin,
    accountLimit,
    cardExpiry,
    login,
    register,
    registerReferral,
    registerTrial,
    fetchTrialStatus,
    fetchReferralInfo,
    renew,
    renewOffline,
    logout,
    fetchUserInfo,
    changePassword,
  }
})
