import { onBeforeUnmount, reactive, ref } from 'vue'
import QRCode from 'qrcode'
import api, { getApiErrorMessage } from '@/api'

export interface MengkaLoginOptions {
  /** 返回扫码登录新 QQ 的归属用户（管理员代操作时）；普通用户无需提供 */
  getOwner?: () => string | undefined
  /** 登录成功（bound 或 confirmed）后回调，用于刷新账号列表 */
  onSuccess?: (qq: string) => void | Promise<void>
}

/**
 * 萌卡 QQ 扫码登录流程：发起登录 → 出二维码 → 轮询确认。
 * 供添加账号弹窗与萌卡管理页共用。
 */
export function useMengkaLogin(options: MengkaLoginOptions = {}) {
  const step = ref<'idle' | 'form' | 'qr'>('idle')
  const qq = ref('')
  const password = ref('')
  const loading = ref(false)
  const error = ref('')
  const status = ref('')
  const success = ref('')
  const qrDataUrl = ref('')
  const expiresAt = ref(0)
  const pendingQq = ref('')
  const guaranteeToken = ref('')
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let pollVersion = 0

  function reset() {
    pollVersion += 1
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = undefined
    }
    step.value = 'idle'
    qq.value = ''
    password.value = ''
    loading.value = false
    error.value = ''
    status.value = ''
    success.value = ''
    qrDataUrl.value = ''
    expiresAt.value = 0
    pendingQq.value = ''
    guaranteeToken.value = ''
  }

  function finishSuccess(targetQq: string) {
    reset()
    success.value = `${targetQq} 已登录萌卡并完成绑定，列表已更新`
    void options.onSuccess?.(targetQq)
  }

  async function showQr(data: { qq?: string, qrUrl?: string, guaranteeToken?: string, expiresIn?: number }) {
    pendingQq.value = String(data.qq || qq.value)
    guaranteeToken.value = String(data.guaranteeToken || '')
    expiresAt.value = Date.now() + (Number(data.expiresIn) || 180) * 1000
    try {
      qrDataUrl.value = await QRCode.toDataURL(String(data.qrUrl || ''), { width: 220, margin: 1 })
    }
    catch {
      qrDataUrl.value = ''
    }
    step.value = 'qr'
    status.value = '等待 QQ 扫码'
    void pollLoop()
  }

  async function pollLoop() {
    const version = pollVersion
    if (step.value !== 'qr' || !guaranteeToken.value)
      return
    if (Date.now() > expiresAt.value) {
      status.value = ''
      error.value = '二维码已失效，请重新发起登录'
      return
    }
    try {
      const payload: any = { qq: pendingQq.value, guaranteeToken: guaranteeToken.value }
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/login-qr/poll', payload, { timeout: 30000 } as any)
      if (version !== pollVersion || step.value !== 'qr')
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '登录状态查询失败')
        return
      }
      const state = String(data.data?.state || '')
      if (state === 'confirmed') {
        finishSuccess(pendingQq.value)
        return
      }
      if (state === 'scanned') {
        status.value = '已扫码，请在手机上确认'
      }
      else if (state === 'expired') {
        status.value = ''
        error.value = '二维码已失效，请重新发起登录'
        return
      }
      pollTimer = setTimeout(() => void pollLoop(), 2000)
    }
    catch (e: any) {
      if (version !== pollVersion)
        return
      error.value = getApiErrorMessage(e, '登录状态查询失败')
    }
  }

  /** 发起扫码登录新 QQ（qq/password 取内部输入框状态） */
  async function start() {
    const target = qq.value.trim()
    if (!/^\d{5,12}$/.test(target)) {
      error.value = '请输入有效的 QQ 号（5-12 位数字）'
      return
    }
    loading.value = true
    error.value = ''
    status.value = ''
    const version = ++pollVersion
    try {
      const payload: any = { qq: target }
      if (password.value) payload.password = password.value
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/login-qr/start', payload, { timeout: 90000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '发起登录失败')
        return
      }
      if (data.data?.mode === 'bound') {
        finishSuccess(target)
        return
      }
      await showQr(data.data)
    }
    catch (e: any) {
      if (version === pollVersion)
        error.value = getApiErrorMessage(e, '发起登录失败')
    }
    finally {
      if (version === pollVersion)
        loading.value = false
    }
  }

  /** 重新登录掉线的萌卡账号（缓存登录或扫码确认），成功后走 onSuccess */
  async function relogin(selfId: string) {
    const target = String(selfId || '').trim()
    if (!target) {
      error.value = '缺少要重新登录的账号'
      return
    }
    loading.value = true
    error.value = ''
    status.value = ''
    success.value = ''
    const version = ++pollVersion
    try {
      const payload: any = { self_id: target }
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/relogin', payload, { timeout: 90000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '重新登录失败')
        return
      }
      if (data.data?.mode === 'bound') {
        finishSuccess(target)
        return
      }
      await showQr(data.data)
    }
    catch (e: any) {
      if (version === pollVersion)
        error.value = getApiErrorMessage(e, '重新登录失败')
    }
    finally {
      if (version === pollVersion)
        loading.value = false
    }
  }

  onBeforeUnmount(reset)

  // reactive 包装使模板中嵌套 ref 自动解包（mengkaLogin.step / mengkaLogin.loading 等）
  return reactive({
    step,
    qq,
    password,
    loading,
    error,
    status,
    success,
    qrDataUrl,
    reset,
    start,
    relogin,
  })
}
