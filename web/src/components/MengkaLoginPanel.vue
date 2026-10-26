<script setup lang="ts">
import { onMounted } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

/**
 * 萌卡 QQ 登录流程面板：idle 表单（添加/重登）→ 验证方式选择 → 短信/滑块/扫码 → 完成绑定。
 * 状态与动作来自 useMengkaLogin 实例，AccountModal 与萌卡管理页共用。
 */
const props = defineProps<{
  login: {
    step: 'idle' | 'form' | 'qr' | 'verify' | 'sms' | 'slider' | 'identity'
    qq: string
    password: string
    loading: boolean
    error: string
    status: string
    success: string
    qrDataUrl: string
    protocols: { id: number, type: string, ver: string, packagename?: string }[]
    protocolId: number
    verifyInfo: { reasonPrompt: string, verifyList: number[], smsPhoneSign: string, securityUrl: string }
    smsInfo: { verifyType: number, sign: string, maskedPhone: string, smsContent: string, sendTo: string }
    smsCode: string
    sliderUrl: string
    sliderResultUrl: string
    sliderPopupOpen: boolean
    sliderWatchNote: string
    openSliderPopup: () => void
    identityUrl: string
    reset: () => void
    start: () => Promise<void>
    relogin: (selfId: string) => Promise<void>
    loadProtocols: () => Promise<void>
    loadVerifyMethods: () => Promise<void>
    chooseVerifyMethod: (verifyType: number) => Promise<void>
    submitSms: () => Promise<void>
    submitSliderUrl: () => Promise<void>
  }
  mode: 'add' | 'relogin'
  reloginBot?: { selfId: string, nickname: string, online: boolean } | null
  /** 默认登录协议：tablet=平板（不顶手机在线）、phone=手机；留空不自动选择 */
  defaultProtocol?: 'tablet' | 'phone'
  /** 登录协议说明文字；留空使用内置默认 */
  protocolNote?: string
}>()

defineEmits<{ (e: 'close'): void }>()

const protocolTypeLabels: Record<string, string> = { Phone: '手机', Pad: '平板' }

const protocolOptions = () => props.login.protocols.map(item => ({
  label: `${protocolTypeLabels[item.type] || item.type} Android ${item.ver}`,
  value: item.id,
}))

function verifyMethodLabel(type: number): string {
  if (type === 4)
    return '接收短信验证码（发送到密保手机）'
  if (type === 3)
    return '发送短信（用密保手机发送指定内容）'
  if (type === 10)
    return '扫码验证（手机 QQ 扫码）'
  return `其他方式（${type}）`
}

/** 按默认协议偏好选择（当前未手动选择时）：平板不顶手机在线，默认优先平板 */
async function applyDefaultProtocol() {
  if (props.login.protocolId || !props.defaultProtocol || !props.login.protocols.length)
    return
  const wantType = props.defaultProtocol === 'phone' ? 'Phone' : 'Pad'
  const match = props.login.protocols.find(item => item.type === wantType)
    || props.login.protocols.find(item => item.type === 'Pad')
  if (match)
    props.login.protocolId = match.id
}

onMounted(() => {
  void props.login.loadProtocols().then(() => applyDefaultProtocol())
})
</script>

<template>
  <div class="space-y-4">
    <p v-if="login.success" class="text-sm" style="color: #10b981">
      {{ login.success }}
    </p>

    <!-- 第一步：表单（idle：入口；form：填写中） -->
    <template v-if="login.step === 'idle' || login.step === 'form'">
      <template v-if="mode === 'relogin' && reloginBot">
        <div class="rounded-xl p-3 text-sm" style="background: rgba(127, 127, 127, 0.08)">
          <div class="font-bold">
            {{ reloginBot.nickname || reloginBot.selfId }}
          </div>
          <div class="mt-1 text-xs opacity-60">
            QQ {{ reloginBot.selfId }} · 当前{{ reloginBot.online ? '在线' : '离线' }}
          </div>
        </div>
        <BaseInput
          v-model="login.password"
          type="password"
          label="QQ 密码（可选）"
          placeholder="缓存密码失效时请填写，将同步更新到萌卡"
          class="farm-input"
        />
        <p class="text-xs opacity-60">
          发起后若需要验证会弹出二维码，用手机 QQ 扫码确认即可恢复在线
        </p>
      </template>
      <template v-else>
        <slot name="header" />
        <BaseInput
          v-model="login.qq"
          label="QQ 号"
          placeholder="请输入要登录的 QQ 号"
          class="farm-input"
        />
        <BaseSelect
          v-model="login.protocolId"
          label="登录协议"
          :options="protocolOptions()"
          placeholder="选择登录协议"
        />
        <p class="-mt-2 text-xs opacity-60">
          {{ props.protocolNote || '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉' }}
        </p>
        <BaseInput
          v-model="login.password"
          type="password"
          label="QQ 密码（可选）"
          placeholder="部分账号需要密码验证，建议填写"
          class="farm-input"
        />
        <p class="text-xs opacity-60">
          发起后按提示完成验证（短信验证码 / 扫码），成功后自动绑定到当前账号
        </p>
      </template>
      <p v-if="login.error" class="text-sm text-red-500">
        {{ login.error }}
      </p>
      <div class="flex justify-end gap-2 pt-2">
        <BaseButton variant="outline" @click="login.reset(); $emit('close')">
          取消
        </BaseButton>
        <BaseButton
          v-if="mode === 'relogin' && reloginBot"
          variant="primary"
          :loading="login.loading"
          @click="login.relogin(reloginBot.selfId)"
        >
          发起重新登录
        </BaseButton>
        <BaseButton v-else variant="primary" :loading="login.loading" @click="login.start()">
          发起登录
        </BaseButton>
      </div>
    </template>

    <!-- 验证方式选择 -->
    <template v-else-if="login.step === 'verify'">
      <div class="rounded-xl p-3 text-sm" style="background: rgba(59, 130, 246, 0.08)">
        <div class="font-bold">
          {{ login.verifyInfo.reasonPrompt }}
        </div>
        <div class="mt-1 text-xs opacity-60">
          密码验证已通过，请选择一种二次验证方式完成登录
        </div>
      </div>
      <div class="space-y-2">
        <BaseButton
          v-for="type in login.verifyInfo.verifyList"
          :key="type"
          variant="outline"
          block
          :loading="login.loading"
          @click="login.chooseVerifyMethod(type)"
        >
          {{ verifyMethodLabel(type) }}
        </BaseButton>
      </div>
      <p v-if="login.verifyInfo.securityUrl" class="text-xs opacity-60">
        如以上方式不可用，可在浏览器打开安全验证页面完成后重试：
        <a :href="login.verifyInfo.securityUrl" target="_blank" rel="noopener" style="color: var(--theme-primary)">打开安全验证页</a>
      </p>
      <p v-if="login.error" class="text-sm text-red-500">
        {{ login.error }}
      </p>
      <div class="flex justify-end gap-2 pt-2">
        <BaseButton variant="outline" :loading="login.loading" @click="login.loadVerifyMethods">
          刷新方式
        </BaseButton>
        <BaseButton variant="outline" @click="login.reset(); $emit('close')">
          取消
        </BaseButton>
      </div>
    </template>

    <!-- 短信验证 -->
    <template v-else-if="login.step === 'sms'">
      <div class="rounded-xl p-3 text-sm" style="background: rgba(59, 130, 246, 0.08)">
        <div class="font-bold">
          {{ login.smsInfo.verifyType === 4 ? '短信验证码验证' : '发送短信验证' }}
        </div>
        <div v-if="login.smsInfo.maskedPhone" class="mt-1 text-xs opacity-60">
          密保手机：{{ login.smsInfo.maskedPhone }}
        </div>
      </div>
      <template v-if="login.smsInfo.verifyType === 4">
        <BaseInput
          v-model="login.smsCode"
          label="短信验证码"
          placeholder="请输入收到的验证码"
          class="farm-input"
        />
      </template>
      <template v-else>
        <div class="space-y-2 border border-gray-200 rounded-xl p-3 text-sm dark:border-gray-700">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            请用密保手机（{{ login.smsInfo.maskedPhone || '见上' }}）把以下内容原样发送到
            <span class="font-mono font-bold">{{ login.smsInfo.sendTo || '-' }}</span>：
          </p>
          <p class="rounded bg-gray-50 p-2 text-center font-mono text-base font-bold tracking-wider dark:bg-gray-800">
            {{ login.smsInfo.smsContent || '-' }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            发送完成后点「我已发送」，系统回查确认后自动完成登录
          </p>
        </div>
      </template>
      <p v-if="login.status" class="text-xs opacity-60">
        {{ login.status }}
      </p>
      <p v-if="login.error" class="text-sm text-red-500">
        {{ login.error }}
      </p>
      <div class="flex justify-end gap-2 pt-2">
        <BaseButton variant="outline" @click="login.reset(); $emit('close')">
          取消
        </BaseButton>
        <BaseButton variant="primary" :loading="login.loading" @click="login.submitSms()">
          {{ login.smsInfo.verifyType === 4 ? '提交验证码' : '我已发送' }}
        </BaseButton>
      </div>
    </template>

    <!-- 扫码验证 -->
    <template v-else-if="login.step === 'qr'">
      <div class="flex flex-col items-center gap-2">
        <div v-if="login.qrDataUrl" class="bg-white p-2">
          <img :src="login.qrDataUrl" alt="萌卡登录二维码" class="h-48 w-48">
        </div>
        <div v-else class="h-48 w-48 flex items-center justify-center text-sm opacity-60">
          二维码生成中...
        </div>
        <p class="text-sm" :style="{ color: 'var(--theme-text)' }">
          {{ login.status }}
        </p>
        <p v-if="login.error" class="text-sm text-red-500">
          {{ login.error }}
        </p>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <BaseButton variant="outline" @click="login.reset(); $emit('close')">
          取消
        </BaseButton>
      </div>
    </template>

    <!-- 滑块验证 -->
    <template v-else-if="login.step === 'slider'">
      <div class="space-y-3">
        <div class="rounded-xl p-3 text-sm" style="background: rgba(59, 130, 246, 0.08)">
          <div class="font-bold">
            滑块验证
          </div>
          <div class="mt-1 text-xs opacity-60">
            点击下方按钮弹出独立验证小窗，完成拖块后面板会自动获取结果并继续登录，当前页面不会丢失
          </div>
        </div>
        <BaseButton variant="secondary" block @click="login.openSliderPopup()">
          {{ login.sliderPopupOpen ? '重新打开验证窗口' : '打开滑块验证窗口' }}
        </BaseButton>
        <p v-if="login.sliderWatchNote" class="text-xs" style="color: #438d63">
          {{ login.sliderWatchNote }}
        </p>
        <div>
          <div class="mb-1 text-xs opacity-60">
            自动获取未生效？将验证完成后地址栏的完整链接粘贴到下方（在页面任意处按 Ctrl+V 也会自动提交）
          </div>
          <BaseInput
            v-model="login.sliderResultUrl"
            placeholder="粘贴完成后地址栏的完整链接（选填）"
            class="farm-input"
          />
        </div>
        <p v-if="login.error" class="text-sm text-red-500">
          {{ login.error }}
        </p>
        <div class="flex justify-end gap-2 pt-2">
          <BaseButton variant="outline" @click="login.reset(); $emit('close')">
            取消
          </BaseButton>
          <BaseButton
            variant="primary"
            :loading="login.loading"
            :disabled="!login.sliderResultUrl.trim()"
            @click="login.submitSliderUrl()"
          >
            提交验证结果
          </BaseButton>
        </div>
      </div>
    </template>

    <!-- 身份验证（V1 引导 WebUI） -->
    <template v-else-if="login.step === 'identity'">
      <div class="space-y-3">
        <div class="rounded-xl p-3 text-sm" style="background: rgba(245, 158, 11, 0.12); color: #b45309">
          <div class="font-bold">
            需要身份验证
          </div>
          <div class="mt-1 text-xs leading-5">
            该账号需要在萌卡 WebUI 完成身份验证（绑定手机等），面板暂不支持代理此流程。
          </div>
        </div>
        <BaseButton v-if="login.identityUrl" variant="secondary" block :href="login.identityUrl" target="_blank" rel="noopener">
          打开身份验证页面
        </BaseButton>
        <div class="flex justify-end gap-2">
          <BaseButton variant="outline" @click="login.reset(); $emit('close')">
            知道了
          </BaseButton>
        </div>
      </div>
    </template>
  </div>
</template>
