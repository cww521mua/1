<script setup lang="ts">
import api, { getApiErrorMessage } from '@/api'
import { NButton } from 'naive-ui/es/button'
import { onMounted, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'

interface LoginTabItem { key: string, label: string, enabled: boolean }
interface LoginConfigForm {
  wechatQrLogin: boolean
  qqQrLogin: boolean
  napCatEndpoint: string
  napCatSignature: string
  tabs: LoginTabItem[]
  mengkaDefaultProtocol: 'tablet' | 'phone'
  mengkaAddButtonLabel: string
  mengkaProtocolNote: string
  mengkaEntryHint: string
}

const TAB_KEY_LABELS: Record<string, string> = {
  code: '输入 Code 登录',
  wx_qr: '微信扫码登录',
  qq_qr: 'QQ扫码登录',
  mengka: '萌卡登录',
  capture: '抓包登录',
}

const TAB_KEY_DESC: Record<string, string> = {
  code: '手动粘贴登录 Code（QQ / 微信小程序）',
  wx_qr: '微信扫码，需在系统设置开启微信扫码登录',
  qq_qr: 'QQ 扫码，需配置 NapCat 接口并开启 QQ 扫码登录',
  mengka: '萌卡 NT 对接：密码 / 扫码登录 QQ 并自动取授权',
  capture: '抓包代理获取登录 Code',
}

const protocolOptions = [
  { label: '平板（默认，不顶手机在线）', value: 'tablet' },
  { label: '手机（会顶手机 QQ 在线）', value: 'phone' },
]

const loading = ref(true)
const saving = ref(false)
const form = ref<LoginConfigForm>({
  wechatQrLogin: true,
  qqQrLogin: false,
  napCatEndpoint: '',
  napCatSignature: '',
  tabs: [],
  mengkaDefaultProtocol: 'tablet',
  mengkaAddButtonLabel: '添加QQ号',
  mengkaProtocolNote: '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉',
  mengkaEntryHint: '列表里没有你的 QQ？发起后按提示完成验证（短信验证码 / 扫码）即可自动登录萌卡并绑定',
})

/** 微信 / QQ 扫码标签的显示由对应扫码登录开关控制，不提供第二个开关 */
function tabSwitchHidden(key: string): boolean {
  return key === 'wx_qr' || key === 'qq_qr'
}

function tabSwitchLockedText(key: string): string {
  if (key === 'wx_qr')
    return form.value.wechatQrLogin ? '显示中（由微信扫码登录开关控制）' : '已隐藏（微信扫码登录未开启）'
  if (key === 'qq_qr')
    return form.value.qqQrLogin ? '显示中（由QQ扫码登录开关控制）' : '已隐藏（QQ扫码登录未开启）'
  return ''
}

function toForm(data: any) {
  const tabs = Array.isArray(data?.tabs) ? data.tabs : []
  form.value = {
    wechatQrLogin: data?.wechatQrLogin !== false,
    qqQrLogin: data?.qqQrLogin === true,
    napCatEndpoint: String(data?.napCatEndpoint || ''),
    napCatSignature: String(data?.napCatSignature || ''),
    tabs: tabs
      .map((tab: any) => ({
        key: String(tab?.key || ''),
        label: String(tab?.label || TAB_KEY_LABELS[tab?.key] || tab?.key || '').trim(),
        enabled: tab?.enabled !== false,
      }))
      .filter((tab: any) => TAB_KEY_LABELS[tab.key]),
    mengkaDefaultProtocol: data?.mengkaDefaultProtocol === 'phone' ? 'phone' : 'tablet',
    mengkaAddButtonLabel: String(data?.mengkaAddButtonLabel || '添加QQ号'),
    mengkaProtocolNote: String(data?.mengkaProtocolNote || '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉'),
    mengkaEntryHint: String(data?.mengkaEntryHint || '列表里没有你的 QQ？发起后按提示完成验证（短信验证码 / 扫码）即可自动登录萌卡并绑定'),
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/api/settings/login-config')
    if (data?.ok)
      toForm(data.data || {})
  }
  catch (e: any) {
    console.error('加载登录设置失败:', e)
  }
  finally {
    loading.value = false
  }
})

function moveTab(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= form.value.tabs.length)
    return
  const tabs = [...form.value.tabs]
  const item = tabs[index]
  if (!item || !tabs[target])
    return
  tabs[index] = tabs[target]
  tabs[target] = item
  form.value.tabs = tabs
}

const notice = ref<{ text: string, ok: boolean } | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function showAlertInline(text: string, ok: boolean) {
  notice.value = { text, ok }
  if (noticeTimer)
    clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 3000)
}

async function handleSave() {
  if (saving.value)
    return
  if (form.value.qqQrLogin && (!form.value.napCatEndpoint.trim() || !form.value.napCatSignature.trim())) {
    showAlertInline('开启 QQ 扫码登录前，请配置 NapCat 接口地址和接口签名', false)
    return
  }
  saving.value = true
  try {
    const { data } = await api.post('/api/settings/login-config', {
      wechatQrLogin: form.value.wechatQrLogin,
      qqQrLogin: form.value.qqQrLogin,
      napCatEndpoint: form.value.napCatEndpoint.trim(),
      napCatSignature: form.value.napCatSignature.trim(),
      tabs: form.value.tabs,
      mengkaDefaultProtocol: form.value.mengkaDefaultProtocol,
      mengkaAddButtonLabel: form.value.mengkaAddButtonLabel.trim(),
      mengkaProtocolNote: form.value.mengkaProtocolNote.trim(),
      mengkaEntryHint: form.value.mengkaEntryHint.trim(),
    })
    if (data?.ok && data.data)
      toForm(data.data)
    showAlertInline(data?.ok ? '登录设置已保存，重新打开添加账号弹窗即可生效' : getApiErrorMessage(data, '保存失败'), data?.ok)
  }
  catch (e: any) {
    showAlertInline(getApiErrorMessage(e, '保存失败'), false)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        登录设置
      </h3>
      <BaseButton variant="primary" size="sm" :loading="saving" @click="handleSave">
        <span class="i-carbon-save mr-2" />
        保存登录设置
      </BaseButton>
    </div>

    <p v-if="notice" class="rounded-lg px-3 py-2 text-sm" :class="notice.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/25 dark:text-green-400' : 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-400'">
      {{ notice.text }}
    </p>

    <div v-if="loading" class="text-sm text-gray-500 dark:text-gray-400">
      正在加载登录设置…
    </div>

    <template v-else>
      <!-- 扫码登录开关 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
            <span class="i-carbon-camera text-xl" />
          </div>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              扫码登录
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              对应登录方式标签的显示开关（原系统设置中的登录设置已合并至此）
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="form.wechatQrLogin" label="微信扫码登录" />
          </div>
          <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <BaseSwitch v-model="form.qqQrLogin" label="QQ扫码登录" />
          </div>
        </div>

        <div
          v-if="form.qqQrLogin"
          class="grid grid-cols-1 mt-4 gap-3 border border-gray-200 rounded-lg bg-gray-50/70 p-4 sm:grid-cols-2 dark:border-gray-700 dark:bg-gray-900/30"
        >
          <BaseInput
            v-model="form.napCatEndpoint"
            label="NapCat接口地址"
            type="text"
            placeholder="http://127.0.0.1:6099"
          />
          <BaseInput
            v-model="form.napCatSignature"
            label="NapCat接口签名"
            type="password"
            placeholder="请输入 NapCat 接口签名"
          />
        </div>
      </section>

      <!-- 登录方式标签 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400">
            <span class="i-carbon-tabs text-xl" />
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              登录方式标签
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              添加账号弹窗中登录方式的标题、顺序与显示开关；标题留空回退默认文字
            </p>
          </div>
        </div>

        <div class="space-y-2">
          <div
            v-for="(tab, index) in form.tabs"
            :key="tab.key"
            class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30"
          >
            <div class="flex flex-wrap items-center gap-3">
              <BaseSwitch v-if="!tabSwitchHidden(tab.key)" v-model="tab.enabled">
                <span class="text-xs text-gray-500 dark:text-gray-400">显示</span>
              </BaseSwitch>
              <span v-else class="text-xs text-gray-400 dark:text-gray-500">
                {{ tabSwitchLockedText(tab.key) }}
              </span>
              <div class="min-w-0 flex-1">
                <BaseInput v-model="tab.label" type="text" :placeholder="TAB_KEY_LABELS[tab.key]" />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {{ TAB_KEY_DESC[tab.key] || tab.key }}
                </p>
              </div>
              <div class="flex flex-none gap-1">
                <NButton size="tiny" quaternary :disabled="index === 0" @click="moveTab(index, -1)">
                  上移
                </NButton>
                <NButton size="tiny" quaternary :disabled="index === form.tabs.length - 1" @click="moveTab(index, 1)">
                  下移
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 萌卡登录 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
            <span class="i-carbon-qr-code text-xl" />
          </div>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              萌卡登录
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              萌卡登录页签的默认协议与提示文案
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseSelect v-model="form.mengkaDefaultProtocol" label="默认登录协议" :options="protocolOptions" />
          <BaseInput v-model="form.mengkaAddButtonLabel" label="添加入口按钮文字" type="text" placeholder="添加QQ号" />
          <BaseTextarea v-model="form.mengkaProtocolNote" label="登录协议说明" :rows="2" class="sm:col-span-2" placeholder="默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉" />
          <BaseTextarea v-model="form.mengkaEntryHint" label="入口提示（列表里没有你的 QQ…）" :rows="2" class="sm:col-span-2" placeholder="发起后按提示完成验证即可自动登录萌卡并绑定" />
        </div>
      </section>

      <div class="flex justify-end">
        <BaseButton variant="primary" :loading="saving" @click="handleSave">
          保存登录设置
        </BaseButton>
      </div>
    </template>
  </div>
</template>
