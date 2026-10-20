import { onBeforeUnmount, reactive, ref } from 'vue'
import QRCode from 'qrcode'
import api, { getApiErrorMessage } from '@/api'

export interface MengkaLoginOptions {
  /** 返回扫码登录新 QQ 的归属用户（管理员代操作时）；普通用户无需提供 */
  getOwner?: () => string | undefined
  /** 登录成功（bound 或 confirmed）后回调，用于刷新账号列表 */
  onSuccess?: (qq: string) => void | Promise<void>
}

export interface MengkaProtocol {
  id: number
  type: string
  ver: string
  packagename?: string
  qua?: string
}

interface VerifyInfo {
  reasonPrompt: string
  verifyList: number[]
  smsPhoneSign: string
  securityUrl: string
}

interface SmsInfo {
  verifyType: number
  sign: string
  maskedPhone: string
  smsContent: string
  sendTo: string
}

/**
 * 萌卡 QQ 登录流程状态机：发起登录 → 密码/风控验证（短信、滑块、扫码）→ 完成绑定。
 * 供添加账号弹窗与萌卡管理页共用。
 */
export function useMengkaLogin(options: MengkaLoginOptions = {}) {
  const step = ref<'idle' | 'form' | 'qr' | 'verify' | 'sms' | 'slider' | 'identity'>('idle')
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

  // 验证状态机数据
  const verifyInfo = ref<VerifyInfo>({ reasonPrompt: '', verifyList: [], smsPhoneSign: '', securityUrl: '' })
  const smsInfo = ref<SmsInfo>({ verifyType: 4, sign: '', maskedPhone: '', smsContent: '', sendTo: '' })
  const sliderUrl = ref('')
  const identityUrl = ref('')
  const smsCode = ref('')
  const sliderResultUrl = ref('')

  // 登录协议（add 模式可选）
  const protocols = ref<MengkaProtocol[]>([])
  const protocolId = ref(0)

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
    verifyInfo.value = { reasonPrompt: '', verifyList: [], smsPhoneSign: '', securityUrl: '' }
    smsInfo.value = { verifyType: 4, sign: '', maskedPhone: '', smsContent: '', sendTo: '' }
    sliderUrl.value = ''
    identityUrl.value = ''
    smsCode.value = ''
    sliderResultUrl.value = ''
    protocolId.value = 0
  }

  function finishSuccess(targetQq: string) {
    reset()
    success.value = `${targetQq} 已登录萌卡并完成绑定，列表已更新`
    void options.onSuccess?.(targetQq)
  }

  /** 登录结果分发：bound 成功 / qr 扫码 / verify 短信或扫码选择 / slider 滑块 / identity 引导 WebUI */
  function handleLoginResult(data: any): boolean {
    if (!data?.mode)
      return false
    if (data.mode === 'bound') {
      finishSuccess(String(data.qq || pendingQq.value))
      return true
    }
    if (data.mode === 'qr') {
      pendingQq.value = String(data.qq || pendingQq.value)
      guaranteeToken.value = String(data.guaranteeToken || '')
      expiresAt.value = Date.now() + (Number(data.expiresIn) || 180) * 1000
      void showQr(String(data.qrUrl || ''))
      return true
    }
    if (data.mode === 'verify') {
      pendingQq.value = String(data.qq || pendingQq.value)
      verifyInfo.value = {
        reasonPrompt: String(data.reasonPrompt || '当前账号需要安全验证'),
        verifyList: Array.isArray(data.verifyList) ? data.verifyList : [],
        smsPhoneSign: String(data.smsPhoneSign || ''),
        securityUrl: String(data.securityUrl || ''),
      }
      step.value = 'verify'
      return true
    }
    if (data.mode === 'slider') {
      pendingQq.value = String(data.qq || pendingQq.value)
      sliderUrl.value = String(data.sliderUrl || '')
      sliderResultUrl.value = ''
      step.value = 'slider'
      return true
    }
    if (data.mode === 'identity') {
      pendingQq.value = String(data.qq || pendingQq.value)
      identityUrl.value = String(data.identityUrl || '')
      step.value = 'identity'
      return true
    }
    return false
  }

  async function showQr(qrUrl: string) {
    try {
      qrDataUrl.value = await QRCode.toDataURL(qrUrl, { width: 220, margin: 1 })
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

  /** 拉取可选登录协议（Android Phone） */
  async function loadProtocols() {
    if (protocols.value.length)
      return
    try {
      const { data } = await api.get('/api/mengka/protocols', { skipErrorToast: true } as any)
      protocols.value = data?.ok && Array.isArray(data.data?.protocols) ? data.data.protocols : []
    }
    catch {
      protocols.value = []
    }
  }

  /** 发起扫码登录新 QQ（qq/password/protocolId 取内部输入框状态） */
  async function start() {
    const target = qq.value.trim()
    if (!/^\d{5,12}$/.test(target)) {
      error.value = '请输入有效的 QQ 号（5-12 位数字）'
      return
    }
    loading.value = true
    error.value = ''
    status.value = ''
    success.value = ''
    pendingQq.value = target
    const version = ++pollVersion
    try {
      const payload: any = { qq: target, protocol_id: protocolId.value }
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
      if (!handleLoginResult(data.data)) {
        error.value = getApiErrorMessage(data, '发起登录失败')
      }
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

  /** 重新登录掉线的萌卡账号（可选填密码更新缓存密码），成功后走 onSuccess */
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
    pendingQq.value = target
    const version = ++pollVersion
    try {
      const payload: any = { self_id: target }
      if (password.value) payload.password = password.value
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/relogin', payload, { timeout: 90000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '重新登录失败')
        return
      }
      if (!handleLoginResult(data.data)) {
        error.value = getApiErrorMessage(data, '重新登录失败')
      }
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

  /** 重新查询安全验证方式（verify 页「刷新方式」按钮） */
  async function loadVerifyMethods() {
    const target = pendingQq.value
    if (!target) {
      error.value = '缺少要验证的账号'
      return
    }
    loading.value = true
    error.value = ''
    const version = ++pollVersion
    try {
      const payload: any = { qq: target }
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/verify/methods', payload, { timeout: 30000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '查询验证方式失败')
        return
      }
      verifyInfo.value = {
        reasonPrompt: String(data.data?.reasonPrompt || '当前账号需要安全验证'),
        verifyList: Array.isArray(data.data?.verifyList) ? data.data.verifyList : [],
        smsPhoneSign: String(data.data?.smsPhoneSign || ''),
        securityUrl: String(data.data?.securityUrl || ''),
      }
    }
    catch (e: any) {
      if (version === pollVersion)
        error.value = getApiErrorMessage(e, '查询验证方式失败')
    }
    finally {
      if (version === pollVersion)
        loading.value = false
    }
  }

  /** 选择验证方式：10=扫码出二维码；4/3=进入短信流程 */
  async function chooseVerifyMethod(verifyType: number) {
    const target = pendingQq.value
    if (!target)
      return
    if (verifyType === 10) {
      loading.value = true
      error.value = ''
      const version = ++pollVersion
      try {
        const payload: any = { self_id: target }
        const owner = options.getOwner?.()
        if (owner) payload.owner = owner
        const { data } = await api.post('/api/mengka/verify/qr', payload, { timeout: 30000 } as any)
        if (version !== pollVersion)
          return
        if (!data?.ok) {
          error.value = getApiErrorMessage(data, '获取登录二维码失败')
          return
        }
        await showQr(String(data.data?.qrUrl || ''))
      }
      catch (e: any) {
        if (version === pollVersion)
          error.value = getApiErrorMessage(e, '获取登录二维码失败')
      }
      finally {
        if (version === pollVersion)
          loading.value = false
      }
      return
    }
    if (verifyType !== 3 && verifyType !== 4) {
      error.value = '暂不支持该验证方式，请选择短信或扫码'
      return
    }
    loading.value = true
    error.value = ''
    const version = ++pollVersion
    try {
      const payload: any = { qq: target, verifyType, sign: verifyInfo.value.smsPhoneSign }
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/verify/sms', payload, { timeout: 30000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '请求短信验证失败')
        return
      }
      if (data.data?.failed) {
        error.value = String(data.data?.prompt || '短信验证请求失败')
        return
      }
      smsInfo.value = {
        verifyType,
        sign: String(data.data?.sign || ''),
        maskedPhone: String(data.data?.maskedPhone || ''),
        smsContent: String(data.data?.smsContent || ''),
        sendTo: String(data.data?.sendTo || ''),
      }
      smsCode.value = ''
      step.value = 'sms'
      status.value = verifyType === 4 ? `验证码已发送至 ${smsInfo.value.maskedPhone || '密保手机'}` : '请用密保手机发送短信'
    }
    catch (e: any) {
      if (version === pollVersion)
        error.value = getApiErrorMessage(e, '请求短信验证失败')
    }
    finally {
      if (version === pollVersion)
        loading.value = false
    }
  }

  /** 提交短信验证（type 4 提交验证码；type 3 回查），通过后自动完成登录 */
  async function submitSms() {
    const target = pendingQq.value
    if (!target)
      return
    if (smsInfo.value.verifyType === 4 && !smsCode.value.trim()) {
      error.value = '请输入收到的短信验证码'
      return
    }
    loading.value = true
    error.value = ''
    const version = ++pollVersion
    try {
      const payload: any = {
        qq: target,
        verifyType: smsInfo.value.verifyType,
        sign: smsInfo.value.sign,
      }
      if (smsInfo.value.verifyType === 4) payload.code = smsCode.value.trim()
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/verify/check-sms', payload, { timeout: 90000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '短信验证提交失败')
        return
      }
      if (data.data?.passed === false) {
        error.value = String(data.data?.prompt || '验证未通过，请重试')
        return
      }
      if (!handleLoginResult(data.data)) {
        error.value = '登录未完成，请重试'
      }
    }
    catch (e: any) {
      if (version === pollVersion)
        error.value = getApiErrorMessage(e, '短信验证提交失败')
    }
    finally {
      if (version === pollVersion)
        loading.value = false
    }
  }

  /** 解析滑块完成后的跳转 URL 并提交（ticket/randstr） */
  async function submitSliderUrl() {
    const target = pendingQq.value
    if (!target)
      return
    const raw = sliderResultUrl.value.trim()
    const ticket = raw.match(/[?&]ticket=([^&\s]+)/)?.[1]
    const randstr = raw.match(/[?&]randstr=([^&\s]+)/)?.[1]
    if (!ticket || !randstr) {
      error.value = '无法从粘贴的链接中解析验证结果，请确认已复制滑块完成后的完整地址'
      return
    }
    loading.value = true
    error.value = ''
    const version = ++pollVersion
    try {
      const payload: any = {
        qq: target,
        ticket: decodeURIComponent(ticket),
        randstr: decodeURIComponent(randstr),
      }
      const owner = options.getOwner?.()
      if (owner) payload.owner = owner
      const { data } = await api.post('/api/mengka/verify/slider', payload, { timeout: 90000 } as any)
      if (version !== pollVersion)
        return
      if (!data?.ok) {
        error.value = getApiErrorMessage(data, '滑块验证提交失败')
        return
      }
      if (!handleLoginResult(data.data)) {
        error.value = '登录未完成，请重试'
      }
    }
    catch (e: any) {
      if (version === pollVersion)
        error.value = getApiErrorMessage(e, '滑块验证提交失败')
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
    protocols,
    protocolId,
    verifyInfo,
    smsInfo,
    smsCode,
    sliderUrl,
    sliderResultUrl,
    identityUrl,
    reset,
    start,
    relogin,
    loadProtocols,
    loadVerifyMethods,
    chooseVerifyMethod,
    submitSms,
    submitSliderUrl,
  })
}
