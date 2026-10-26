<script setup lang="ts">
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { NRadio, NRadioGroup } from 'naive-ui/es/radio'
import { NTab, NTabs } from 'naive-ui/es/tabs'
import { useIntervalFn } from '@vueuse/core'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useMengkaLogin } from '@/composables/useMengkaLogin'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import MengkaLoginPanel from '@/components/MengkaLoginPanel.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useUserStore } from '@/stores/user'
import { runWxLoginStatusPoll } from '@/utils/wx-login-poll'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

interface CaptureFlowState {
  id: string
  platform: 'qq' | 'wx'
  codeCaptured: boolean
  accountGid: string
  friendCount: number
  captureStatus: string
  proxy: {
    running: boolean
    status: string
    error: string
  }
  publicInfo: {
    host: string
    addresses: { address: string, kind: string }[]
    mitmPort: number
    remainingSec: number
    certificateUrl: string
  }
}

const loading = ref(false)
const errorMessage = ref('')
const activeLoginTab = ref<'code' | 'wx_qr' | 'qq_qr' | 'mengka' | 'capture'>('code')
const loginSettingsLoaded = ref(false)
const LOGIN_TAB_LABELS: Record<string, string> = {
  code: '输入 Code 登录',
  wx_qr: '微信扫码登录',
  qq_qr: 'QQ扫码登录',
  mengka: '萌卡登录',
  capture: '抓包登录',
}
const loginSettings = ref({
  wechatQrLogin: true,
  qqQrLogin: false,
  napCatEndpoint: '',
  napCatSignature: '',
  tabs: Object.entries(LOGIN_TAB_LABELS).map(([key, label]) => ({ key, label, enabled: true })),
  mengkaDefaultProtocol: 'tablet' as 'tablet' | 'phone',
  mengkaAddButtonLabel: '添加QQ号',
  mengkaProtocolNote: '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉',
  mengkaEntryHint: '列表里没有你的 QQ？发起后按提示完成验证（短信验证码 / 扫码）即可自动登录萌卡并绑定',
})
let loginSettingsRequestVersion = 0
const wxTaskId = ref('')
const wxStatus = ref('')
const wxError = ref('')
const wxLoading = ref(false)
const wxQrUrl = ref('')
let wxPollTimer: ReturnType<typeof setTimeout> | undefined
let wxQrObjectUrl = ''
let wxFlowVersion = 0
let wxPollController: AbortController | undefined
let wxPollInFlight: Promise<void> | undefined
let wxPollKey = ''
let wxPendingCode = ''
const qqTaskId = ref('')
const qqStatus = ref('')
const qqError = ref('')
const qqLoading = ref(false)
const qqQrUrl = ref('')
let qqPollTimer: ReturnType<typeof setTimeout> | undefined
let qqFlowVersion = 0
let qqPollController: AbortController | undefined
let qqPollInFlight: Promise<void> | undefined
let qqPollKey = ''
let qqPendingCode = ''
let qrNameSubmitTimer: ReturnType<typeof setTimeout> | undefined

const CAPTURE_SUCCESS_STORAGE_KEY = 'capture_login_succeeded'

const captureEnabled = ref(false)
const captureLoading = ref(false)
const captureChecking = ref(false)
const captureCompleting = ref(false)
const captureError = ref('')
const captureCopiedField = ref<'host' | 'port' | ''>('')
const captureAccountName = ref('')
const capturePlatform = ref<'qq' | 'wx'>('qq')
const showCaptureHelp = ref(false)
const captureHelpMode = ref<'first' | 'daily'>('first')
const captureHelpDevice = ref<'ios' | 'android'>('ios')
const captureFlow = ref<CaptureFlowState | null>(null)

const wechatQrLoginEnabled = computed(() => loginSettingsLoaded.value && loginSettings.value.wechatQrLogin)
const qqQrLoginEnabled = computed(() => loginSettingsLoaded.value && loginSettings.value.qqQrLogin)

/** 标签能力开关：微信/QQ 受登录设置控制，萌卡/抓包受服务端状态控制 */
const loginTabCapability = computed<Record<string, boolean>>(() => ({
  code: true,
  wx_qr: wechatQrLoginEnabled.value,
  qq_qr: qqQrLoginEnabled.value,
  mengka: mengkaEnabled.value,
  capture: captureEnabled.value,
}))

/** 按配置顺序过滤出可见的登录方式标签 */
const visibleLoginTabs = computed(() => loginSettings.value.tabs
  .filter(tab => tab.enabled && loginTabCapability.value[tab.key]))

/** 当前标签不可见时回退到第一个可见标签；全部不可见时退回 Code */
function fallbackLoginTab(): 'code' | 'wx_qr' | 'qq_qr' | 'mengka' | 'capture' {
  if (visibleLoginTabs.value.some(tab => tab.key === activeLoginTab.value))
    return activeLoginTab.value
  return (visibleLoginTabs.value[0]?.key || 'code') as 'code' | 'wx_qr' | 'qq_qr' | 'mengka' | 'capture'
}

const captureHelpSteps = computed(() => captureHelpMode.value === 'first'
  ? [
      '点击开始抓取，获取本次代理地址和端口',
      '打开 CA 证书，并在手机系统中安装和信任',
      '连续添加时，先切换到目标 QQ 并彻底关闭上一个农场',
      '将手机 Wi-Fi 代理设置为页面显示的地址和端口',
      '彻底关闭后重新打开对应的 QQ 或微信农场',
      'Code 获取后账号会立即添加；QQ 好友 GID 将在后台继续同步',
      'QQ 农场保持打开，完整好友列表同步后会立即释放代理，最迟约 15 秒',
    ]
  : [
      '点击开始抓取，确认本次代理地址和端口',
      '连续添加时，先切换到目标 QQ 并彻底关闭上一个农场',
      '将手机 Wi-Fi 代理更新为本次显示的地址和端口',
      '重新打开对应农场，并保持页面打开',
      '账号添加后，QQ 农场继续保持打开，最迟约 15 秒完成后台同步',
      '后台同步结束后，将手机 Wi-Fi 代理改回关闭',
    ])

const captureDeviceSteps = computed(() => captureHelpDevice.value === 'ios'
  ? [
      '在 Safari 中点击“打开证书”并允许下载描述文件',
      '进入“设置 → 通用 → VPN 与设备管理”安装描述文件',
      '进入“设置 → 通用 → 关于本机 → 证书信任设置”启用完全信任',
    ]
  : [
      '点击“打开证书”下载 CA 文件',
      '进入系统安全设置中的“安装证书”或“凭据存储”',
      '选择 CA 证书并确认安装；不同品牌的菜单名称可能不同',
    ])

const captureCurrentStep = computed(() => {
  if (!captureFlow.value)
    return '开始新的抓取任务'
  if (!captureFlow.value.codeCaptured)
    return `设置 Wi-Fi 代理并打开${captureFlow.value.platform === 'qq' ? ' QQ' : '微信'}农场`
  return '已获取 Code，正在立即完成账号操作'
})

const captureNextStep = computed(() => {
  if (!captureFlow.value)
    return '开始后按本次显示的代理信息设置手机 Wi-Fi'
  if (!captureFlow.value.codeCaptured)
    return '重新打开小程序，并保持农场页面打开'
  if (captureFlow.value.platform === 'qq')
    return `即将自动${props.editData ? '更新' : '添加'}账号，好友 GID 将在后台同步`
  return `即将自动${props.editData ? '更新' : '添加'}账号`
})

// 表单数据
const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

// 添加账号
async function addAccount(data: any, isRelogin = false) {
  const name = String(data?.name || '').trim()
  if (!isRelogin && !name) {
    errorMessage.value = '请输入账号备注'
    return false
  }

  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', { ...data, name })
    if (res.data.ok) {
      emit('saved')
      close()
      return true
    }
    else {
      errorMessage.value = `保存失败: ${getApiErrorMessage(res.data, '请求失败')}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${getApiErrorMessage(e, '请求失败')}`
  }
  finally {
    loading.value = false
  }

  return false
}

function clearQrNameSubmitTimer() {
  if (qrNameSubmitTimer) {
    clearTimeout(qrNameSubmitTimer)
    qrNameSubmitTimer = undefined
  }
}

// 游戏为新建农场号自动生成的初始昵称（教学文案），不适合作为账号备注
const GAME_PLACEHOLDER_NICK_RE = /创建账号|开启智慧农耕之旅/

function usableNickname(value: string): string {
  const nick = String(value || '').trim()
  return nick && !GAME_PLACEHOLDER_NICK_RE.test(nick) ? nick : ''
}

// ==================== 萌卡对接 ====================
interface MengkaBot {
  selfId: string
  nickname: string
  clientType: string
  online: boolean
  status?: number
  statusText?: string
  lastActiveMs?: number
  canManage?: boolean
  owner?: string | null
}

const userStore = useUserStore()
const mengkaEnabled = ref(false)
const mengkaConnected = ref(false)
const mengkaNodeLabel = ref('')
const mengkaBots = ref<MengkaBot[]>([])
const mengkaSelectedBot = ref('')
const mengkaLoading = ref(false)
const mengkaError = ref('')
const mengkaLoaded = ref(false)
const ownerTarget = ref('')
const ownerOptions = ref<{ username: string }[]>([])

// 萌卡登录面板模式与解绑确认
const mengkaLoginMode = ref<'add' | 'relogin'>('add')
const mengkaReloginBot = ref<MengkaBot | null>(null)
const showUnbindMengkaConfirm = ref(false)
const unbindMengkaTarget = ref<MengkaBot | null>(null)
const unbindMengkaLoading = ref(false)
const showDeleteMengkaConfirm = ref(false)
const deleteMengkaTarget = ref<MengkaBot | null>(null)
const deleteMengkaLoading = ref(false)

function fmtBotLastActive(ms?: number): string {
  if (!ms)
    return '—'
  const diff = Date.now() - ms
  if (diff < 60_000)
    return '刚刚'
  if (diff < 3_600_000)
    return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000)
    return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

const mengkaListBots = computed(() => mengkaBots.value.filter(bot => bot.clientType === 'android'))

const ownerSelectOptions = computed(() => [
  { label: '超级管理员', value: '' },
  ...ownerOptions.value.map(user => ({ label: user.username, value: user.username })),
])

async function loadMengkaState() {
  mengkaLoading.value = true
  try {
    const { data } = await api.get('/api/mengka/status', { skipErrorToast: true } as any)
    mengkaEnabled.value = data?.ok && data.data?.enabled === true
    mengkaConnected.value = data?.data?.connected === true
    const nodes = Array.isArray(data?.data?.nodes) ? data.data.nodes : []
    const node = nodes[0] || {}
    const parts = [String(node.name || node.title || '').trim()]
    const latency = Number(node.latency ?? node.delay)
    if (Number.isFinite(latency) && latency >= 0)
      parts.push(`<${latency}ms`)
    const running = Number(node.running ?? node.account_count)
    const total = Number(node.total ?? node.capacity)
    if (Number.isFinite(running) && Number.isFinite(total) && total > 0)
      parts.push(`${running}/${total} 运行`)
    mengkaNodeLabel.value = parts.filter(Boolean).join('，') || '已连接萌卡框架'

    if (mengkaEnabled.value && mengkaConnected.value) {
      const res = await api.get('/api/mengka/bots', { skipErrorToast: true } as any)
      mengkaBots.value = Array.isArray(res.data?.data?.bots) ? res.data.data.bots : []
      const options = mengkaListBots.value
      if (!options.some(opt => opt.selfId === mengkaSelectedBot.value))
        mengkaSelectedBot.value = options[0]?.selfId || ''
      mengkaError.value = options.length ? '' : '暂无可用的萌卡账号，可扫码登录新 QQ 添加'
    }
    else if (mengkaEnabled.value) {
      mengkaNodeLabel.value = '萌卡框架未连接，请联系管理员检查对接配置'
    }

    if (userStore.isAdmin && !ownerOptions.value.length) {
      try {
        const res = await api.get('/api/admin/users', { skipErrorToast: true } as any)
        ownerOptions.value = Array.isArray(res.data?.data) ? res.data.data : []
      }
      catch { /* 归属选项加载失败不阻塞添加流程 */ }
    }
    mengkaLoaded.value = true
  }
  catch {
    mengkaEnabled.value = false
    mengkaLoaded.value = true
  }
  finally {
    mengkaLoading.value = false
  }
}

async function fetchFarmCodeFromMengka() {
  const bot = mengkaBots.value.find(item => item.selfId === mengkaSelectedBot.value)
  if (!bot) {
    mengkaError.value = '请选择要授权的萌卡账号'
    return
  }
  if (!bot.online) {
    mengkaError.value = '该 QQ 当前离线，请重新扫码登录后再获取授权 Code'
    return
  }
  mengkaLoading.value = true
  mengkaError.value = ''
  try {
    const { data } = await api.post('/api/mengka/farm-code', { self_id: bot.selfId }, { timeout: 70000 } as any)
    if (!data?.ok) {
      mengkaError.value = getApiErrorMessage(data, '获取农场授权 Code 失败')
      return
    }
    const code = String(data.data?.code || '').trim()
    const name = form.name.trim() || usableNickname(bot.nickname)
    if (!name) {
      mengkaError.value = '未获取到 QQ 昵称，请填写账号备注'
      return
    }
    const payload: any = { name, code, platform: 'qq', loginType: 'manual' }
    if (userStore.isAdmin && ownerTarget.value)
      payload.owner = ownerTarget.value
    await addAccount(payload, !!props.editData)
  }
  catch (e: any) {
    mengkaError.value = getApiErrorMessage(e, '获取农场授权 Code 失败')
  }
  finally {
    mengkaLoading.value = false
  }
}

// ==================== 萌卡扫码登录（把 QQ 登录进萌卡并绑定） ====================
function mengkaLoginOwner(): string | undefined {
  return userStore.isAdmin && ownerTarget.value ? ownerTarget.value : undefined
}

const mengkaLogin = useMengkaLogin({
  getOwner: mengkaLoginOwner,
  onSuccess: async () => {
    mengkaLoginMode.value = 'add'
    mengkaReloginBot.value = null
    await loadMengkaState()
  },
})

// 验证流程进行中（扫码/短信/滑块）禁止误关弹窗
const mengkaLoginBusy = computed(() => ['qr', 'verify', 'sms', 'slider'].includes(mengkaLogin.step))

function openMengkaAdd() {
  mengkaLoginMode.value = 'add'
  mengkaReloginBot.value = null
  mengkaLogin.reset()
  mengkaLogin.step = 'form'
}

function openMengkaRelogin(bot: MengkaBot) {
  mengkaLoginMode.value = 'relogin'
  mengkaReloginBot.value = bot
  mengkaLogin.reset()
}

function closeMengkaLoginPanel() {
  mengkaLogin.reset()
  mengkaLoginMode.value = 'add'
  mengkaReloginBot.value = null
}

function askUnbindMengka(bot: MengkaBot) {
  unbindMengkaTarget.value = bot
  showUnbindMengkaConfirm.value = true
}

function askDeleteMengka(bot: MengkaBot) {
  deleteMengkaTarget.value = bot
  showDeleteMengkaConfirm.value = true
}

async function confirmDeleteMengka() {
  const target = deleteMengkaTarget.value
  if (!target)
    return
  deleteMengkaLoading.value = true
  try {
    const { data } = await api.post('/api/mengka/bots/delete', { selfId: target.selfId })
    if (data?.ok) {
      showDeleteMengkaConfirm.value = false
      deleteMengkaTarget.value = null
      if (mengkaSelectedBot.value === target.selfId)
        mengkaSelectedBot.value = ''
      await loadMengkaState()
    }
    else {
      mengkaError.value = getApiErrorMessage(data, '删除萌卡账号失败')
    }
  }
  catch (e: any) {
    mengkaError.value = getApiErrorMessage(e, '删除萌卡账号失败')
  }
  finally {
    deleteMengkaLoading.value = false
  }
}

async function confirmUnbindMengka() {
  const target = unbindMengkaTarget.value
  if (!target)
    return
  unbindMengkaLoading.value = true
  try {
    const { data } = await api.delete(`/api/mengka/bindings/${target.selfId}`)
    if (data?.ok) {
      showUnbindMengkaConfirm.value = false
      unbindMengkaTarget.value = null
      if (mengkaSelectedBot.value === target.selfId)
        mengkaSelectedBot.value = ''
      await loadMengkaState()
    }
    else {
      showUnbindMengkaConfirm.value = false
      unbindMengkaTarget.value = null
    }
  }
  catch {
    showUnbindMengkaConfirm.value = false
    unbindMengkaTarget.value = null
  }
  finally {
    unbindMengkaLoading.value = false
  }
}

async function addQrAccount(platform: 'wx' | 'qq', code: string, nickname: string) {
  const name = form.name.trim() || nickname
  if (platform === 'wx')
    wxPendingCode = code
  else
    qqPendingCode = code

  if (!name) {
    if (platform === 'wx') {
      wxStatus.value = '登录授权已完成，等待填写账号备注'
      wxError.value = '未获取到微信昵称，请填写账号备注'
    }
    else {
      qqStatus.value = '登录授权已完成，等待填写账号备注'
      qqError.value = '未获取到 QQ 昵称，请填写账号备注'
    }
    return
  }

  form.name = name
  await submitPendingQrAccount(platform)
}

async function submitPendingQrAccount(platform: 'wx' | 'qq') {
  const name = form.name.trim() || props.editData?.name || ''
  const code = platform === 'wx' ? wxPendingCode : qqPendingCode
  if (!name || !code || !props.show || activeLoginTab.value !== `${platform}_qr`)
    return

  if (platform === 'wx') {
    wxPendingCode = ''
    wxError.value = ''
    wxStatus.value = props.editData ? '正在重新登录...' : '正在添加账号...'
  }
  else {
    qqPendingCode = ''
    qqError.value = ''
    qqStatus.value = props.editData ? '正在重新登录...' : '正在添加账号...'
  }

  const payload: any = { name, code, platform, loginType: 'manual' }
  const saved = await addAccount(payload, !!props.editData)
  if (!saved && props.show && activeLoginTab.value === `${platform}_qr`) {
    if (platform === 'wx')
      wxPendingCode = code
    else
      qqPendingCode = code
  }
}

async function loadLoginSettings() {
  const requestVersion = ++loginSettingsRequestVersion
  loginSettingsLoaded.value = false
  try {
    const response = await api.get('/api/settings/login-config', { skipErrorToast: true } as any)
    if (requestVersion !== loginSettingsRequestVersion)
      return
    const data = response.data?.data
    const tabs = Array.isArray(data?.tabs) ? data.tabs : []
    loginSettings.value = {
      wechatQrLogin: typeof data?.wechatQrLogin === 'boolean' ? data.wechatQrLogin : true,
      qqQrLogin: typeof data?.qqQrLogin === 'boolean' ? data.qqQrLogin : false,
      napCatEndpoint: typeof data?.napCatEndpoint === 'string' ? data.napCatEndpoint : '',
      napCatSignature: typeof data?.napCatSignature === 'string' ? data.napCatSignature : '',
      tabs: tabs
        .map((tab: any) => ({
          key: String(tab?.key || ''),
          label: String(tab?.label || LOGIN_TAB_LABELS[tab?.key] || tab?.key || '').trim(),
          enabled: tab?.enabled !== false,
        }))
        .filter((tab: any) => LOGIN_TAB_LABELS[tab.key]),
      mengkaDefaultProtocol: data?.mengkaDefaultProtocol === 'phone' ? 'phone' : 'tablet',
      mengkaAddButtonLabel: String(data?.mengkaAddButtonLabel || '添加QQ号'),
      mengkaProtocolNote: String(data?.mengkaProtocolNote || '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉'),
      mengkaEntryHint: String(data?.mengkaEntryHint || '列表里没有你的 QQ？发起后按提示完成验证（短信验证码 / 扫码）即可自动登录萌卡并绑定'),
    }
  }
  catch {
    if (requestVersion !== loginSettingsRequestVersion)
      return
    // Keep the existing login entries available when an older server has no endpoint yet.
    loginSettings.value = {
      wechatQrLogin: true,
      qqQrLogin: false,
      napCatEndpoint: '',
      napCatSignature: '',
      tabs: Object.entries(LOGIN_TAB_LABELS).map(([key, label]) => ({ key, label, enabled: true })),
      mengkaDefaultProtocol: 'tablet',
      mengkaAddButtonLabel: '添加QQ号',
      mengkaProtocolNote: '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉',
      mengkaEntryHint: '列表里没有你的 QQ？发起后按提示完成验证（短信验证码 / 扫码）即可自动登录萌卡并绑定',
    }
  }
  finally {
    if (requestVersion === loginSettingsRequestVersion) {
      loginSettingsLoaded.value = true
      if (activeLoginTab.value !== fallbackLoginTab())
        activeLoginTab.value = fallbackLoginTab()
      if (activeLoginTab.value === 'qq_qr' && loginSettings.value.qqQrLogin && !qqTaskId.value)
        void startQqLogin()
    }
  }
}

// 手动提交
async function submitManual() {
  errorMessage.value = ''
  if (!props.editData && !form.name.trim()) {
    errorMessage.value = '请输入账号备注'
    return
  }
  if (!form.code) {
    errorMessage.value = '请输入Code'
    return
  }
  form.name = form.name.trim()

  let code = form.code.trim()
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code
  }

  const payload: any = {
    name: form.name,
    code,
    platform: props.editData ? (props.editData.platform || 'qq') : form.platform,
    loginType: 'manual',
  }

  await addAccount(payload, !!props.editData)
}

function stopWxPolling() {
  if (wxPollTimer) {
    clearTimeout(wxPollTimer)
    wxPollTimer = undefined
  }
  wxPollController?.abort()
  wxPollController = undefined
}

function resetWxLogin() {
  const oldTaskId = wxTaskId.value
  wxFlowVersion += 1
  stopWxPolling()
  if (oldTaskId) {
    void api.delete(`/api/wx-login/tasks/${oldTaskId}`, { skipErrorToast: true } as any).catch(() => undefined)
  }
  if (wxQrObjectUrl) {
    URL.revokeObjectURL(wxQrObjectUrl)
    wxQrObjectUrl = ''
  }
  wxTaskId.value = ''
  wxStatus.value = ''
  wxError.value = ''
  wxQrUrl.value = ''
  wxLoading.value = false
  wxPendingCode = ''
  clearQrNameSubmitTimer()
}

function isWxFlowActive(taskId: string, flowVersion: number) {
  return flowVersion === wxFlowVersion && taskId === wxTaskId.value
}

async function getWxCodeAndAdd(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return
  const codeResult = await api.post(`/api/wx-login/tasks/${taskId}/code`)
  if (!isWxFlowActive(taskId, flowVersion))
    return
  const code = String(codeResult.data?.data?.code || '').trim()
  const nickname = String(codeResult.data?.data?.nickname || '').trim()
  if (!code)
    throw new Error('未获取到登录 Code')

  await addQrAccount('wx', code, usableNickname(nickname))
}

async function confirmWxLogin(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return
  wxStatus.value = '正在建立登录会话...'
  await api.post(`/api/wx-login/tasks/${taskId}/confirm`)
  if (!isWxFlowActive(taskId, flowVersion))
    return
  await getWxCodeAndAdd(taskId, flowVersion)
}

async function pollWxLoginRequest(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return

  const controller = new AbortController()
  wxPollController = controller
  try {
    const response = await runWxLoginStatusPoll(() => api.get(`/api/wx-login/tasks/${taskId}/status`, {
      timeout: 40000,
      signal: controller.signal,
      skipErrorToast: true,
    } as any))
    if (!isWxFlowActive(taskId, flowVersion))
      return
    const status = response.data?.data?.status
    if (status === 'waiting') {
      wxStatus.value = '等待微信扫码'
    }
    else if (status === 'scanned') {
      wxStatus.value = '已扫码，请在手机上确认'
    }
    else if (status === 'authorized') {
      stopWxPolling()
      await confirmWxLogin(taskId, flowVersion)
      return
    }
    else if (['cancelled', 'expired', 'failed'].includes(status)) {
      wxError.value = '二维码已失效，请重新获取'
      return
    }
    wxPollTimer = setTimeout(() => void pollWxLogin(taskId, flowVersion), 1200)
  }
  catch (error: any) {
    if (!isWxFlowActive(taskId, flowVersion) || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED')
      return
    wxError.value = getApiErrorMessage(error, '登录状态检查失败')
  }
  finally {
    if (wxPollController === controller)
      wxPollController = undefined
  }
}

async function pollWxLogin(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return

  const previous = wxPollInFlight
  const previousKey = wxPollKey
  if (previous) {
    await previous.catch(() => undefined)
    if (!isWxFlowActive(taskId, flowVersion))
      return
    if (previousKey === `${taskId}:${flowVersion}`)
      return
  }

  const current = pollWxLoginRequest(taskId, flowVersion)
  wxPollInFlight = current
  wxPollKey = `${taskId}:${flowVersion}`
  try {
    await current
  }
  finally {
    if (wxPollInFlight === current) {
      wxPollInFlight = undefined
      wxPollKey = ''
    }
  }
}

async function startWxLogin() {
  if (!wechatQrLoginEnabled.value) {
    activeLoginTab.value = fallbackLoginTab()
    return
  }
  resetWxLogin()
  const flowVersion = wxFlowVersion
  wxLoading.value = true
  try {
    const response = await api.post('/api/wx-login/tasks', { app_id: 'wx5306c5978fdb76e4' })
    const task = response.data?.data
    const taskId = String(task?.task_id || '')
    if (!taskId)
      throw new Error('未创建登录任务')
    if (flowVersion !== wxFlowVersion) {
      void api.delete(`/api/wx-login/tasks/${taskId}`, { skipErrorToast: true } as any).catch(() => undefined)
      return
    }
    wxTaskId.value = taskId
    const qrResponse = await api.get(task.qr_url, { responseType: 'blob' })
    if (!isWxFlowActive(taskId, flowVersion))
      return
    wxQrObjectUrl = URL.createObjectURL(qrResponse.data)
    wxQrUrl.value = wxQrObjectUrl
    wxStatus.value = '等待微信扫码'
    void pollWxLogin(taskId, flowVersion)
  }
  catch (error: any) {
    if (flowVersion !== wxFlowVersion)
      return
    wxError.value = getApiErrorMessage(error, '二维码获取失败')
  }
  finally {
    if (flowVersion === wxFlowVersion)
      wxLoading.value = false
  }
}

function stopQqPolling() {
  if (qqPollTimer) {
    clearTimeout(qqPollTimer)
    qqPollTimer = undefined
  }
  qqPollController?.abort()
  qqPollController = undefined
}

function resetQqLogin() {
  const taskId = qqTaskId.value
  qqFlowVersion += 1
  stopQqPolling()
  if (taskId)
    void cancelQqLoginTask(taskId)
  qqTaskId.value = ''
  qqStatus.value = ''
  qqError.value = ''
  qqQrUrl.value = ''
  qqLoading.value = false
  qqPendingCode = ''
  clearQrNameSubmitTimer()
}

function isQqFlowActive(taskId: string, flowVersion: number) {
  return flowVersion === qqFlowVersion && taskId === qqTaskId.value
}

function ensureQqApiOk(response: any, fallback: string) {
  const payload = response?.data
  if (payload?.ok === false)
    throw new Error(getApiErrorMessage(payload, fallback))
  return payload
}

async function getQqCodeAndAdd(taskId: string, flowVersion: number) {
  if (!isQqFlowActive(taskId, flowVersion))
    return
  qqLoading.value = true
  qqStatus.value = '正在获取小程序授权 Code...'
  try {
    const response = await api.post(`/api/qq-login/tasks/${taskId}/code`, undefined, { timeout: 120000 } as any)
    if (!isQqFlowActive(taskId, flowVersion))
      return
    const payload = ensureQqApiOk(response, '获取小程序授权 Code 失败')
    const code = String(payload?.data?.code || '').trim()
    const nickname = String(payload?.data?.nickname || '').trim()
    if (!code)
      throw new Error('未获取到登录 Code')
    await addQrAccount('qq', code, usableNickname(nickname))
  }
  catch (error: any) {
    if (isQqFlowActive(taskId, flowVersion))
      qqError.value = getApiErrorMessage(error, '获取小程序授权 Code 失败')
  }
  finally {
    if (isQqFlowActive(taskId, flowVersion))
      qqLoading.value = false
  }
}

async function cancelQqLoginTask(taskId: string) {
  if (!taskId)
    return
  try {
    const response = await api.post(`/api/qq-login/tasks/${taskId}/cancel`, undefined, {
      timeout: 120000,
      skipErrorToast: true,
    } as any)
    ensureQqApiOk(response, 'QQ 登录任务取消失败')
  }
  catch {}
}

async function pollQqLoginRequest(taskId: string, flowVersion: number) {
  if (!isQqFlowActive(taskId, flowVersion))
    return

  const controller = new AbortController()
  qqPollController = controller
  try {
    const response = await api.post(`/api/qq-login/tasks/${taskId}/status`, undefined, {
      timeout: 120000,
      signal: controller.signal,
      skipErrorToast: true,
    } as any)
    if (!isQqFlowActive(taskId, flowVersion))
      return

    const payload = ensureQqApiOk(response, 'QQ 登录状态检查失败')
    const task = payload?.data
    if (!task)
      throw new Error('QQ 登录状态返回无效')
    const status = String(task?.status || '').trim()
    const qrImage = String(task?.qr_image || '').trim()
    if (qrImage)
      qqQrUrl.value = qrImage

    if (status === 'waiting_scan') {
      qqStatus.value = '等待 QQ 扫码'
    }
    else if (status === 'scanned') {
      qqStatus.value = '已扫码，请在手机上确认'
    }
    else if (status === 'confirmed') {
      stopQqPolling()
      await getQqCodeAndAdd(taskId, flowVersion)
      return
    }
    else if (['cancelled', 'expired', 'failed'].includes(status)) {
      qqError.value = '二维码已失效，请重新获取'
      return
    }
    if (!status) {
      qqError.value = 'QQ 登录状态异常，请重新获取二维码'
      return
    }
    qqPollTimer = setTimeout(() => void pollQqLogin(taskId, flowVersion), 1200)
  }
  catch (error: any) {
    if (!isQqFlowActive(taskId, flowVersion) || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED')
      return
    qqError.value = getApiErrorMessage(error, 'QQ 登录状态检查失败')
  }
  finally {
    if (qqPollController === controller)
      qqPollController = undefined
  }
}

async function pollQqLogin(taskId: string, flowVersion: number) {
  if (!isQqFlowActive(taskId, flowVersion))
    return

  const previous = qqPollInFlight
  const previousKey = qqPollKey
  if (previous) {
    await previous.catch(() => undefined)
    if (!isQqFlowActive(taskId, flowVersion))
      return
    if (previousKey === `${taskId}:${flowVersion}`)
      return
  }

  const current = pollQqLoginRequest(taskId, flowVersion)
  qqPollInFlight = current
  qqPollKey = `${taskId}:${flowVersion}`
  try {
    await current
  }
  finally {
    if (qqPollInFlight === current) {
      qqPollInFlight = undefined
      qqPollKey = ''
    }
  }
}

async function startQqLogin() {
  if (!qqQrLoginEnabled.value) {
    activeLoginTab.value = fallbackLoginTab()
    return
  }
  resetQqLogin()
  const flowVersion = qqFlowVersion
  qqLoading.value = true
  try {
    const response = await api.post('/api/qq-login/tasks')
    const payload = ensureQqApiOk(response, 'QQ 登录二维码获取失败')
    const task = payload?.data
    const taskId = String(task?.task_id || '')
    const qrImage = String(task?.qr_image || '')
    if (!taskId || !qrImage)
      throw new Error('未创建 QQ 登录任务')
    if (flowVersion !== qqFlowVersion)
      return
    qqTaskId.value = taskId
    qqQrUrl.value = qrImage
    qqStatus.value = '等待 QQ 扫码'
    void pollQqLogin(taskId, flowVersion)
  }
  catch (error: any) {
    if (flowVersion === qqFlowVersion)
      qqError.value = getApiErrorMessage(error, 'QQ 登录二维码获取失败')
  }
  finally {
    if (flowVersion === qqFlowVersion)
      qqLoading.value = false
  }
}

const { pause: stopCaptureCheck, resume: startCaptureCheck } = useIntervalFn(async () => {
  if (activeLoginTab.value !== 'capture' || !captureFlow.value || captureCompleting.value || captureChecking.value)
    return
  captureChecking.value = true
  try {
    const response = await api.get(`/api/capture/sessions/${captureFlow.value.id}`, { timeout: 20000 } as any)
    if (!response.data?.ok || !response.data.data)
      return
    captureFlow.value = response.data.data
    captureError.value = response.data.data.proxy?.error || ''
    if (response.data.data.codeCaptured)
      await completeCaptureAccount()
  }
  catch (e: any) {
    captureError.value = getApiErrorMessage(e, '查询抓取状态失败')
  }
  finally {
    captureChecking.value = false
  }
}, 1500, { immediate: false })

async function loadCaptureConfig() {
  try {
    const response = await api.get('/api/capture/config', { skipErrorToast: true } as any)
    captureEnabled.value = response.data?.ok === true && response.data.data?.enabled === true
    if (!captureEnabled.value && activeLoginTab.value === 'capture')
      activeLoginTab.value = fallbackLoginTab()
  }
  catch {
    captureEnabled.value = false
    if (activeLoginTab.value === 'capture')
      activeLoginTab.value = fallbackLoginTab()
  }
}

async function cancelCaptureSession() {
  stopCaptureCheck()
  const flowId = captureFlow.value?.id
  captureFlow.value = null
  if (flowId) {
    try {
      await api.delete(`/api/capture/sessions/${flowId}`, { skipErrorToast: true } as any)
    }
    catch {}
  }
}

async function startCaptureSession() {
  captureLoading.value = true
  captureError.value = ''
  await cancelCaptureSession()
  try {
    const response = await api.post('/api/capture/sessions', {
      platform: capturePlatform.value,
      accountId: props.editData?.id || '',
    }, { timeout: 35000 } as any)
    if (!response.data?.ok || !response.data.data)
      throw new Error(getApiErrorMessage(response.data, '启动抓取失败'))
    captureFlow.value = response.data.data
    startCaptureCheck()
  }
  catch (e: any) {
    captureError.value = getApiErrorMessage(e, '启动抓取失败')
  }
  finally {
    captureLoading.value = false
  }
}

async function completeCaptureAccount() {
  if (!captureFlow.value || captureCompleting.value)
    return
  captureCompleting.value = true
  captureError.value = ''
  try {
    const response = await api.post(`/api/capture/sessions/${captureFlow.value.id}/complete`, {
      name: captureAccountName.value.trim(),
    }, { timeout: 35000 } as any)
    if (!response.data?.ok)
      throw new Error(getApiErrorMessage(response.data, props.editData ? '更新账号失败' : '添加账号失败'))
    localStorage.setItem(CAPTURE_SUCCESS_STORAGE_KEY, '1')
    stopCaptureCheck()
    captureFlow.value = null
    emit('saved')
    close()
  }
  catch (e: any) {
    if (e?.response?.data?.code === 'DUPLICATE_CAPTURE_ACCOUNT') {
      stopCaptureCheck()
      captureFlow.value = null
    }
    captureError.value = getApiErrorMessage(e, props.editData ? '更新账号失败' : '添加账号失败')
  }
  finally {
    captureCompleting.value = false
  }
}

function openCaptureHelp() {
  captureHelpMode.value = localStorage.getItem(CAPTURE_SUCCESS_STORAGE_KEY) === '1' ? 'daily' : 'first'
  showCaptureHelp.value = true
}

async function copyCaptureValue(field: 'host' | 'port') {
  const host = captureFlow.value?.publicInfo.host || ''
  const port = captureFlow.value?.publicInfo.mitmPort || 0
  if (!host || !port)
    return
  const value = field === 'host' ? host : String(port)
  try {
    let copied = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value)
        copied = true
      }
      catch {}
    }
    if (!copied) {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      copied = document.execCommand('copy')
      textarea.remove()
    }
    if (!copied)
      throw new Error('copy failed')
    captureCopiedField.value = field
    setTimeout(() => {
      if (captureCopiedField.value === field)
        captureCopiedField.value = ''
    }, 1800)
  }
  catch {
    captureError.value = '复制失败，请手动填写代理地址和端口'
  }
}

function close() {
  resetWxLogin()
  resetQqLogin()
  mengkaLogin.reset()
  mengkaLoginMode.value = 'add'
  mengkaReloginBot.value = null
  stopCaptureCheck()
  void cancelCaptureSession()
  showCaptureHelp.value = false
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    captureError.value = ''
    captureCopiedField.value = ''
    captureAccountName.value = props.editData?.name || ''
    capturePlatform.value = props.editData?.platform === 'wx' ? 'wx' : 'qq'
    captureHelpMode.value = localStorage.getItem(CAPTURE_SUCCESS_STORAGE_KEY) === '1' ? 'daily' : 'first'
    activeLoginTab.value = fallbackLoginTab()
    resetWxLogin()
    mengkaLogin.reset()
    void loadLoginSettings()
    void loadCaptureConfig()
    void loadMengkaState()
    if (props.editData) {
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
    }
    else {
      form.name = ''
      form.code = ''
      form.platform = 'qq'
    }
  }
})

watch(activeLoginTab, (tab) => {
  if (tab === 'capture' && !captureEnabled.value) {
    activeLoginTab.value = fallbackLoginTab()
    return
  }
  if (tab === 'wx_qr' && wechatQrLoginEnabled.value && !wxTaskId.value)
    void startWxLogin()
  else if (tab === 'wx_qr' && !wechatQrLoginEnabled.value)
    activeLoginTab.value = fallbackLoginTab()
  else if (tab === 'qq_qr') {
    if (qqQrLoginEnabled.value && !qqTaskId.value)
      void startQqLogin()
    else if (!qqQrLoginEnabled.value)
      activeLoginTab.value = fallbackLoginTab()
  }
  else if (tab === 'mengka' && !mengkaLoaded.value) {
    void loadMengkaState()
  }
  if (tab !== 'wx_qr')
    resetWxLogin()
  if (tab !== 'qq_qr')
    resetQqLogin()
  if (tab !== 'capture')
    void cancelCaptureSession()
})

watch(() => form.name, (name) => {
  clearQrNameSubmitTimer()
  if (!name.trim())
    return
  const platform = activeLoginTab.value === 'wx_qr'
    ? 'wx'
    : activeLoginTab.value === 'qq_qr' ? 'qq' : undefined
  if (!platform || !(platform === 'wx' ? wxPendingCode : qqPendingCode))
    return
  qrNameSubmitTimer = setTimeout(() => void submitPendingQrAccount(platform), 800)
})

onBeforeUnmount(() => {
  resetWxLogin()
  resetQqLogin()
  mengkaLogin.reset()
  stopCaptureCheck()
  void cancelCaptureSession()
})
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="!loading && !wxLoading && !qqLoading && !captureLoading && !captureCompleting && !mengkaLoginBusy"
    :close-on-esc="!loading && !wxLoading && !qqLoading && !captureLoading && !captureCompleting && !mengkaLoginBusy"
    @update:show="value => !value && close()"
  >
    <NCard
      class="account-modal-card"
      :title="editData ? '编辑账号' : '添加账号'"
      :bordered="false"
      :closable="!loading && !wxLoading && !qqLoading && !captureLoading && !captureCompleting && !mengkaLoginBusy"
      @close="close"
    >
      <div class="account-modal-content overflow-y-auto">
        <!-- 错误信息 -->
        <div v-if="errorMessage" class="mb-4 rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
          {{ errorMessage }}
        </div>

        <NTabs v-if="loginSettingsLoaded" v-model:value="activeLoginTab" class="mb-4" type="line">
          <NTab v-for="tab in visibleLoginTabs" :key="tab.key" :name="tab.key">
            {{ tab.label }}
          </NTab>
        </NTabs>

        <div v-if="activeLoginTab === 'code'" class="space-y-4">
          <BaseInput
            v-if="!editData"
            v-model="form.name"
            label="账号备注（必填）"
            placeholder="请输入账号备注"
            class="farm-input"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
            class="farm-input"
          />

          <NRadioGroup v-if="!editData" v-model:value="form.platform" name="account-platform">
            <div class="flex gap-5">
              <NRadio value="qq">
                QQ 小程序
              </NRadio>
              <NRadio value="wx">
                微信小程序
              </NRadio>
            </div>
          </NRadioGroup>

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
        <div v-else-if="activeLoginTab === 'wx_qr'" class="space-y-4" role="tabpanel" aria-label="微信扫码登录">
          <BaseInput
            v-model="form.name"
            label="账号备注（可留空）"
            placeholder="留空时使用微信昵称"
            class="farm-input"
          />
          <div class="min-h-64 flex flex-col items-center justify-center gap-3">
            <div v-if="wxQrUrl" class="bg-white p-2">
              <img :src="wxQrUrl" alt="微信登录二维码" class="h-52 w-52">
            </div>
            <div v-else class="h-52 w-52 flex items-center justify-center text-sm opacity-60">
              {{ wxLoading ? '正在获取二维码...' : '二维码不可用' }}
            </div>
            <p class="text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ wxStatus }}
            </p>
            <p v-if="wxError" class="text-sm text-red-500">
              {{ wxError }}
            </p>
          </div>
          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" @click="startWxLogin">
              刷新二维码
            </BaseButton>
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
          </div>
        </div>
        <div v-else-if="activeLoginTab === 'qq_qr'" class="space-y-4" role="tabpanel" aria-label="QQ扫码登录">
          <BaseInput
            v-model="form.name"
            label="账号备注（可留空）"
            placeholder="留空时使用 QQ 昵称"
            class="farm-input"
          />
          <div class="min-h-64 flex flex-col items-center justify-center gap-3">
            <div v-if="qqQrUrl" class="bg-white p-2">
              <img :src="qqQrUrl" alt="QQ登录二维码" class="h-52 w-52">
            </div>
            <div v-else class="h-52 w-52 flex items-center justify-center text-sm opacity-60">
              {{ qqLoading ? '正在获取二维码...' : '二维码不可用' }}
            </div>
            <p class="text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ qqStatus }}
            </p>
            <p v-if="qqError" class="text-sm text-red-500">
              {{ qqError }}
            </p>
          </div>
          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" :loading="qqLoading" @click="startQqLogin">
              刷新二维码
            </BaseButton>
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
          </div>
        </div>
        <div v-else-if="activeLoginTab === 'mengka'" class="space-y-4" role="tabpanel" aria-label="萌卡登录">
          <div v-if="userStore.isAdmin">
            <BaseSelect
              v-model="ownerTarget"
              label="账号归属"
              :options="ownerSelectOptions"
            />
            <p class="mt-1 text-xs opacity-60">
              扫码登录的新 QQ 会归属到所选用户，用于账号列表权限隔离
            </p>
          </div>
          <BaseInput
            v-model="form.name"
            label="账号备注（可选）"
            placeholder="留空时使用 QQ 昵称"
            class="farm-input"
          />
          <div class="rounded-xl p-3 text-sm" style="background: rgba(127, 127, 127, 0.08)">
            当前机器人节点：{{ mengkaNodeLabel }}
          </div>
          <div>
            <p class="mb-1.5 text-sm opacity-70">
              我的萌卡 QQ（点击选择后一键授权；离线可重新登录）
            </p>
            <div v-if="mengkaListBots.length === 0" class="rounded-xl p-3 text-xs opacity-60" style="background: rgba(127, 127, 127, 0.08)">
              还没有萌卡账号，点下方「{{ loginSettings.mengkaAddButtonLabel }}」添加
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="bot in mengkaListBots"
                :key="bot.selfId"
                class="flex items-center justify-between gap-2 border rounded-xl px-3 py-2 text-sm"
                :style="{ borderColor: mengkaSelectedBot === bot.selfId ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-text) 15%, transparent)' }"
                role="button"
                @click="mengkaSelectedBot = bot.selfId"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-sm font-bold">{{ bot.nickname || bot.selfId }}</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                      :class="bot.online ? 'bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
                    >
                      {{ bot.online ? '在线' : '离线' }}
                    </span>
                    <span
                      v-if="userStore.isAdmin && bot.owner"
                      class="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-violet-600 dark:bg-violet-900/25 dark:text-violet-400"
                    >
                      归属：{{ bot.owner }}
                    </span>
                  </div>
                  <p class="mt-0.5 text-xs opacity-60">
                    QQ {{ bot.selfId }}
                  </p>
                  <p class="mt-0.5 text-xs opacity-60">
                    {{ bot.statusText || (bot.online ? '在线' : '离线') }} · 最后活跃 {{ fmtBotLastActive(bot.lastActiveMs) }}
                  </p>
                </div>
                <div class="flex flex-none items-center gap-1.5">
                  <BaseButton
                    v-if="!bot.online"
                    variant="outline"
                    size="sm"
                    @click.stop="openMengkaRelogin(bot)"
                  >
                    重新登录
                  </BaseButton>
                  <BaseButton variant="ghost" size="sm" @click.stop="askUnbindMengka(bot)">
                    解绑
                  </BaseButton>
                  <BaseButton
                    v-if="bot.canManage !== false"
                    variant="ghost"
                    size="sm"
                    class="text-red-500 dark:text-red-400"
                    title="删除该萌卡账号"
                    @click.stop="askDeleteMengka(bot)"
                  >
                    <span class="i-carbon-trash-can" />
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>
          <p v-if="mengkaError" class="text-sm text-red-500">
            {{ mengkaError }}
          </p>
          <p v-if="mengkaLogin.success" class="text-sm" style="color: #10b981">
            {{ mengkaLogin.success }}
          </p>
          <BaseButton
            variant="primary"
            block
            :loading="mengkaLoading"
            :disabled="!mengkaSelectedBot"
            @click="fetchFarmCodeFromMengka"
          >
            获取农场授权 Code
          </BaseButton>
          <div class="border-t pt-3" style="border-color: color-mix(in srgb, var(--theme-text) 12%, transparent)">
              <template v-if="mengkaLoginMode === 'add' && mengkaLogin.step === 'idle'">
                <BaseButton variant="outline" block @click="openMengkaAdd">
                  {{ loginSettings.mengkaAddButtonLabel }}
                </BaseButton>
                <p class="mt-1 text-xs opacity-60">
                  {{ loginSettings.mengkaEntryHint }}
                </p>
              </template>
              <MengkaLoginPanel
                v-else
                :login="mengkaLogin"
                :mode="mengkaLoginMode"
                :relogin-bot="mengkaReloginBot"
                :default-protocol="loginSettings.mengkaDefaultProtocol"
                :protocol-note="loginSettings.mengkaProtocolNote"
                @close="closeMengkaLoginPanel"
              />
            </div>
            <BaseButton variant="outline" block @click="close">
              取消
            </BaseButton>
        </div>
        <div v-else-if="activeLoginTab === 'capture'" class="space-y-4" role="tabpanel" aria-label="抓包登录">
          <BaseInput
            v-model="captureAccountName"
            label="账号备注（可留空）"
            placeholder="留空则使用默认账号名"
            :disabled="!!captureFlow"
            class="farm-input"
          />

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium">平台</label>
            <div class="grid grid-cols-2 gap-2">
              <BaseButton
                :variant="capturePlatform === 'qq' ? 'primary' : 'outline'"
                :disabled="!!captureFlow"
                @click="capturePlatform = 'qq'"
              >
                QQ 小程序
              </BaseButton>
              <BaseButton
                :variant="capturePlatform === 'wx' ? 'primary' : 'outline'"
                :disabled="!!captureFlow"
                @click="capturePlatform = 'wx'"
              >
                微信小程序
              </BaseButton>
            </div>
          </div>

          <BaseButton v-if="!captureFlow" variant="outline" block @click="openCaptureHelp">
            使用说明
          </BaseButton>

          <div v-if="captureError" class="rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
            {{ captureError }}
          </div>

          <div v-if="!captureFlow" class="flex flex-col items-center gap-3 py-4">
            <p class="text-center text-sm opacity-70">
              开始后按页面提示设置手机 Wi-Fi 代理，并保持农场页面打开
            </p>
            <BaseButton variant="primary" :loading="captureLoading" @click="startCaptureSession">
              开始抓取
            </BaseButton>
          </div>

          <template v-else>
            <div class="rounded-xl px-3 py-3 text-sm" style="background: color-mix(in srgb, var(--theme-primary) 10%, transparent)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs opacity-60">
                    当前步骤
                  </div>
                  <div class="mt-1 break-words font-semibold">
                    {{ captureCurrentStep }}
                  </div>
                  <div class="mt-1 break-words text-xs opacity-70">
                    下一步：{{ captureNextStep }}
                  </div>
                </div>
                <BaseButton variant="ghost" size="sm" @click="openCaptureHelp">
                  说明
                </BaseButton>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-sm">
              <div class="min-w-0 flex items-center justify-between gap-1 rounded-xl border px-3 py-3" style="border-color: color-mix(in srgb, var(--theme-text) 15%, transparent)">
                <div class="min-w-0">
                  <div class="text-xs opacity-60">
                    代理服务器
                  </div>
                  <div class="mt-1 break-all font-semibold">
                    {{ captureFlow.publicInfo.host || '-' }}
                  </div>
                </div>
                <BaseButton variant="ghost" size="sm" class="flex-none" :title="captureCopiedField === 'host' ? '已复制' : '复制代理服务器'" @click="copyCaptureValue('host')">
                  {{ captureCopiedField === 'host' ? '已复制' : '复制' }}
                </BaseButton>
              </div>
              <div class="min-w-0 flex items-center justify-between gap-1 rounded-xl border px-3 py-3" style="border-color: color-mix(in srgb, var(--theme-text) 15%, transparent)">
                <div class="min-w-0">
                  <div class="text-xs opacity-60">
                    代理端口
                  </div>
                  <div class="mt-1 font-semibold">
                    {{ captureFlow.publicInfo.mitmPort || '-' }}
                  </div>
                </div>
                <BaseButton variant="ghost" size="sm" class="flex-none" :title="captureCopiedField === 'port' ? '已复制' : '复制代理端口'" @click="copyCaptureValue('port')">
                  {{ captureCopiedField === 'port' ? '已复制' : '复制' }}
                </BaseButton>
              </div>
            </div>

            <div v-if="captureFlow.publicInfo.addresses?.length > 1" class="rounded-xl border p-3 text-sm" style="border-color: color-mix(in srgb, var(--theme-text) 15%, transparent)">
              <div class="mb-2 text-xs opacity-60">
                全部可用地址（按当前网络环境选择，代理端口相同）
              </div>
              <div class="space-y-1.5">
                <div
                  v-for="item in captureFlow.publicInfo.addresses"
                  :key="item.address"
                  class="flex items-center justify-between gap-2"
                >
                  <span class="min-w-0 break-all text-xs font-mono">
                    {{ item.address }}:{{ captureFlow.publicInfo.mitmPort }}
                  </span>
                  <span class="flex-none rounded px-1.5 py-0.5 text-[10px] font-medium" style="background: color-mix(in srgb, currentColor 10%, transparent)">
                    {{ item.kind === 'tailscale' ? 'Tailscale' : item.kind === 'lan' ? '局域网' : '其他' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="rounded-xl p-3 text-sm" style="background: color-mix(in srgb, var(--theme-text) 5%, transparent)">
              <div class="flex items-center justify-between gap-3">
                <span>Code</span>
                <span :style="{ color: captureFlow.codeCaptured ? '#10b981' : '#f59e0b' }">
                  {{ captureFlow.codeCaptured ? '已获取' : '等待中' }}
                </span>
              </div>
              <div v-if="captureFlow.platform === 'qq'" class="mt-2 flex items-center justify-between gap-3">
                <span>好友 GID</span>
                <span style="color: var(--theme-primary)">{{ captureFlow.friendCount }} 个</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-3">
                <span>剩余时间</span>
                <span>{{ captureFlow.publicInfo.remainingSec }} 秒</span>
              </div>
            </div>

            <div class="flex flex-wrap justify-end gap-2 border-t pt-3" style="border-color: color-mix(in srgb, var(--theme-text) 12%, transparent)">
              <BaseButton variant="secondary" size="sm" :href="captureFlow.publicInfo.certificateUrl">
                打开证书
              </BaseButton>
              <BaseButton variant="outline" size="sm" @click="cancelCaptureSession">
                取消抓取
              </BaseButton>
              <BaseButton
                v-if="captureFlow.codeCaptured"
                variant="primary"
                size="sm"
                :loading="captureCompleting"
                @click="completeCaptureAccount"
              >
                {{ editData ? '立即更新' : '立即添加' }}
              </BaseButton>
            </div>
          </template>
        </div>
      </div>
    </NCard>
  </NModal>

  <NModal :show="showCaptureHelp" @update:show="value => (showCaptureHelp = value)">
    <NCard
      class="account-modal-card"
      title="抓包登录使用说明"
      :bordered="false"
      @close="showCaptureHelp = false"
    >
      <div class="max-h-[70vh] space-y-4 overflow-y-auto">
        <div class="grid grid-cols-2 gap-2">
          <BaseButton :variant="captureHelpMode === 'first' ? 'primary' : 'outline'" @click="captureHelpMode = 'first'">
            首次使用
          </BaseButton>
          <BaseButton :variant="captureHelpMode === 'daily' ? 'primary' : 'outline'" @click="captureHelpMode = 'daily'">
            已装证书
          </BaseButton>
        </div>
        <div class="space-y-2">
          <div v-for="(step, index) in captureHelpSteps" :key="step" class="flex items-start gap-3">
            <span class="h-6 w-6 flex flex-none items-center justify-center rounded-full text-xs font-semibold text-white" style="background: var(--theme-primary)">
              {{ index + 1 }}
            </span>
            <span class="min-w-0 break-words text-sm leading-6">{{ step }}</span>
          </div>
        </div>

        <template v-if="captureHelpMode === 'first'">
          <div class="border-t pt-4" style="border-color: color-mix(in srgb, var(--theme-text) 12%, transparent)">
            <div class="mb-3 text-sm font-semibold">
              证书安装帮助
            </div>
            <div class="mb-3 grid grid-cols-2 gap-2">
              <BaseButton :variant="captureHelpDevice === 'ios' ? 'primary' : 'outline'" @click="captureHelpDevice = 'ios'">
                iPhone / iPad
              </BaseButton>
              <BaseButton :variant="captureHelpDevice === 'android' ? 'primary' : 'outline'" @click="captureHelpDevice = 'android'">
                Android
              </BaseButton>
            </div>
            <div class="space-y-2">
              <div v-for="(step, index) in captureDeviceSteps" :key="step" class="flex items-start gap-2 text-xs leading-5">
                <span class="flex-none opacity-60">{{ index + 1 }}.</span>
                <span class="break-words">{{ step }}</span>
              </div>
            </div>
          </div>
        </template>

        <div class="rounded-xl p-3 text-xs leading-5" style="background: rgba(245, 158, 11, 0.12); color: #b45309">
          <div>每次任务的代理端口可能变化，请以当前页面显示为准。</div>
          <div class="mt-1">
            服务端会自动释放代理，但账号完成后仍需在手机上手动关闭 Wi-Fi 代理。
          </div>
          <div v-if="capturePlatform === 'wx'" class="mt-1">
            微信抓取成功后无法继续进入农场属于正常现象。
          </div>
        </div>
      </div>
    </NCard>
  </NModal>

  <!-- 萌卡解绑确认 -->
  <ConfirmModal
    :show="showUnbindMengkaConfirm"
    :loading="unbindMengkaLoading"
    title="解绑萌卡账号"
    :message="unbindMengkaTarget ? `确定解绑 ${unbindMengkaTarget.nickname || unbindMengkaTarget.selfId}（${unbindMengkaTarget.selfId}）？解绑后将无法使用该 QQ 一键授权，可重新扫码绑定` : ''"
    confirm-text="确认解绑"
    type="danger"
    @close="!unbindMengkaLoading && (showUnbindMengkaConfirm = false)"
    @cancel="!unbindMengkaLoading && (showUnbindMengkaConfirm = false)"
    @confirm="confirmUnbindMengka"
  />

  <!-- 萌卡账号删除确认（框架删除 + 解绑 + 撤授权，不可恢复） -->
  <ConfirmModal
    :show="showDeleteMengkaConfirm"
    :loading="deleteMengkaLoading"
    title="删除萌卡账号"
    :message="deleteMengkaTarget ? `确定要删除萌卡账号 ${deleteMengkaTarget.nickname || deleteMengkaTarget.selfId}（${deleteMengkaTarget.selfId}）吗？框架内的登录数据将被移除，绑定与授权同时解除，此操作不可恢复！` : ''"
    confirm-text="删除"
    type="danger"
    @close="!deleteMengkaLoading && (showDeleteMengkaConfirm = false)"
    @cancel="!deleteMengkaLoading && (showDeleteMengkaConfirm = false)"
    @confirm="confirmDeleteMengka"
  />
</template>

<style scoped>
.account-modal-card {
  width: min(448px, calc(100vw - 32px));
}

.account-modal-content {
  max-height: calc(90vh - 100px);
}
</style>
