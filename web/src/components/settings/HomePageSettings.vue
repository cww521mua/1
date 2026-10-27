<script setup lang="ts">
import api, { getApiErrorMessage } from '@/api'
import { NButton } from 'naive-ui/es/button'
import { onMounted, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { HOME_ICONS } from '@/constants/home-icons'

interface HomeFeature { icon: string, title: string, desc: string }
interface HomeStep { title: string, desc: string }
interface HomePageForm {
  brandName: string
  hero: { kicker: string, title1: string, title2: string, highlight: string, description: string, primaryText: string, secondaryText: string, chipsText: string }
  featuresTitle: string
  featuresSubtitle: string
  features: HomeFeature[]
  stepsTitle: string
  stepsSubtitle: string
  steps: HomeStep[]
  cta: { title: string, subtitle: string, primaryText: string, secondaryText: string }
  footerNote: string
}

const MAX_FEATURES = 12
const MAX_STEPS = 4

const iconOptions = HOME_ICONS.map(item => ({ label: item.label, value: item.key }))

const loading = ref(true)
const saving = ref(false)

const form = ref<HomePageForm>({
  brandName: '',
  hero: { kicker: '', title1: '', title2: '', highlight: '', description: '', primaryText: '', secondaryText: '', chipsText: '' },
  featuresTitle: '',
  featuresSubtitle: '',
  features: [],
  stepsTitle: '',
  stepsSubtitle: '',
  steps: [],
  cta: { title: '', subtitle: '', primaryText: '', secondaryText: '' },
  footerNote: '',
})

function toForm(data: any) {
  const hero = data.hero || {}
  const cta = data.cta || {}
  form.value = {
    brandName: String(data.brandName || ''),
    hero: {
      kicker: String(hero.kicker || ''),
      title1: String(hero.title1 || ''),
      title2: String(hero.title2 || ''),
      highlight: String(hero.highlight || ''),
      description: String(hero.description || ''),
      primaryText: String(hero.primaryText || ''),
      secondaryText: String(hero.secondaryText || ''),
      chipsText: Array.isArray(hero.chips) ? hero.chips.join('，') : '',
    },
    featuresTitle: String(data.featuresTitle || ''),
    featuresSubtitle: String(data.featuresSubtitle || ''),
    features: (Array.isArray(data.features) ? data.features : []).map((item: any) => ({
      icon: String(item.icon || 'bolt'),
      title: String(item.title || ''),
      desc: String(item.desc || ''),
    })),
    stepsTitle: String(data.stepsTitle || ''),
    stepsSubtitle: String(data.stepsSubtitle || ''),
    steps: (Array.isArray(data.steps) ? data.steps : []).map((item: any) => ({
      title: String(item.title || ''),
      desc: String(item.desc || ''),
    })),
    cta: {
      title: String(cta.title || ''),
      subtitle: String(cta.subtitle || ''),
      primaryText: String(cta.primaryText || ''),
      secondaryText: String(cta.secondaryText || ''),
    },
    footerNote: String(data.footerNote || ''),
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/api/home-page')
    if (data?.ok)
      toForm(data.data || {})
  }
  catch (e: any) {
    console.error('加载主页配置失败:', e)
  }
  finally {
    loading.value = false
  }
})

function addFeature() {
  if (form.value.features.length >= MAX_FEATURES)
    return
  form.value.features.push({ icon: 'star', title: '', desc: '' })
}

function removeFeature(index: number) {
  form.value.features.splice(index, 1)
}

function addStep() {
  if (form.value.steps.length >= MAX_STEPS)
    return
  form.value.steps.push({ title: '', desc: '' })
}

function removeStep(index: number) {
  form.value.steps.splice(index, 1)
}

function buildPayload() {
  return {
    brandName: form.value.brandName.trim(),
    hero: {
      kicker: form.value.hero.kicker.trim(),
      title1: form.value.hero.title1.trim(),
      title2: form.value.hero.title2.trim(),
      highlight: form.value.hero.highlight.trim(),
      description: form.value.hero.description.trim(),
      primaryText: form.value.hero.primaryText.trim(),
      secondaryText: form.value.hero.secondaryText.trim(),
      chips: form.value.hero.chipsText.split(/[，,、]/).map((item: string) => item.trim()).filter(Boolean),
    },
    featuresTitle: form.value.featuresTitle.trim(),
    featuresSubtitle: form.value.featuresSubtitle.trim(),
    features: form.value.features.map(item => ({ icon: item.icon, title: item.title.trim(), desc: item.desc.trim() })),
    stepsTitle: form.value.stepsTitle.trim(),
    stepsSubtitle: form.value.stepsSubtitle.trim(),
    steps: form.value.steps.map(item => ({ title: item.title.trim(), desc: item.desc.trim() })),
    cta: {
      title: form.value.cta.title.trim(),
      subtitle: form.value.cta.subtitle.trim(),
      primaryText: form.value.cta.primaryText.trim(),
      secondaryText: form.value.cta.secondaryText.trim(),
    },
    footerNote: form.value.footerNote.trim(),
  }
}

async function handleSave() {
  if (saving.value)
    return
  saving.value = true
  try {
    const { data } = await api.post('/api/settings/home-page', buildPayload())
    if (data?.ok && data.data)
      toForm(data.data)
    showAlertInline(data?.ok ? '主页设置已保存，刷新主页即可看到效果' : getApiErrorMessage(data, '保存失败'), data?.ok)
  }
  catch (e: any) {
    showAlertInline(getApiErrorMessage(e, '保存失败'), false)
  }
  finally {
    saving.value = false
  }
}

const notice = ref<{ text: string, ok: boolean } | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function showAlertInline(text: string, ok: boolean) {
  notice.value = { text, ok }
  if (noticeTimer)
    clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 3000)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        主页设置
      </h3>
      <BaseButton variant="primary" size="sm" :loading="saving" @click="handleSave">
        <span class="i-carbon-save mr-2" />
        保存主页设置
      </BaseButton>
    </div>

    <p v-if="notice" class="rounded-lg px-3 py-2 text-sm" :class="notice.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/25 dark:text-green-400' : 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-400'">
      {{ notice.text }}
    </p>

    <div v-if="loading" class="text-sm text-gray-500 dark:text-gray-400">
      正在加载主页配置…
    </div>

    <template v-else>
      <!-- 品牌与首屏 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400">
            <span class="i-carbon-home text-xl" />
          </div>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              品牌与首屏
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              主页顶部导航与首屏展示内容；品牌图标使用「品牌设置」中上传的图标
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput v-model="form.brandName" label="主页品牌名" type="text" placeholder="留空使用品牌设置的主标题" />
          <BaseInput v-model="form.hero.kicker" label="首屏小标签" type="text" placeholder="如：多账号 · 全自动 · 液态玻璃面板" />
          <BaseInput v-model="form.hero.title1" label="主标题第一行" type="text" placeholder="如：多账号挂机，" />
          <BaseInput v-model="form.hero.title2" label="主标题第二行" type="text" placeholder="如：把农场交给全自动" />
          <BaseInput v-model="form.hero.highlight" label="高亮词（绿色显示）" type="text" placeholder="第二行中的词语，如：交给全自动" />
          <BaseInput v-model="form.hero.chipsText" label="特性标签（用逗号分隔）" type="text" placeholder="全天候自动化，账号数据独立" />
          <BaseTextarea v-model="form.hero.description" label="首屏简介" :rows="3" class="sm:col-span-2" placeholder="面向客户的功能简介" />
          <BaseInput v-model="form.hero.primaryText" label="主按钮文字（未登录）" type="text" placeholder="立即注册" />
          <BaseInput v-model="form.hero.secondaryText" label="次按钮文字" type="text" placeholder="视频教程" />
        </div>
      </section>

      <!-- 功能卡 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-400">
            <span class="i-carbon-grid text-xl" />
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              功能卡片（{{ form.features.length }}/{{ MAX_FEATURES }}）
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              主页功能区的卡片内容与图标，最多 {{ MAX_FEATURES }} 张
            </p>
          </div>
          <BaseButton variant="secondary" size="sm" :disabled="form.features.length >= MAX_FEATURES" @click="addFeature">
            <span class="i-carbon-add mr-1" />
            添加卡片
          </BaseButton>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput v-model="form.featuresTitle" label="功能区标题" type="text" />
          <BaseInput v-model="form.featuresSubtitle" label="功能区副标题" type="text" />
        </div>

        <div class="mt-3 space-y-3">
          <div v-for="(feat, index) in form.features" :key="index" class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs text-gray-500 font-semibold dark:text-gray-400">卡片 {{ index + 1 }}</span>
              <NButton size="tiny" quaternary type="error" @click="removeFeature(index)">
                删除
              </NButton>
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <BaseSelect v-model="feat.icon" label="图标" :options="iconOptions" />
              <BaseInput v-model="feat.title" label="标题" type="text" class="sm:col-span-2" />
            </div>
            <BaseTextarea v-model="feat.desc" label="描述" :rows="2" class="mt-3" />
          </div>
        </div>
      </section>

      <!-- 使用步骤 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-400">
            <span class="i-carbon-list-numbers text-xl" />
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              使用步骤（{{ form.steps.length }}/{{ MAX_STEPS }}）
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              主页「如何开始」区的步骤说明，最多 {{ MAX_STEPS }} 步
            </p>
          </div>
          <BaseButton variant="secondary" size="sm" :disabled="form.steps.length >= MAX_STEPS" @click="addStep">
            <span class="i-carbon-add mr-1" />
            添加步骤
          </BaseButton>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput v-model="form.stepsTitle" label="步骤区标题" type="text" />
          <BaseInput v-model="form.stepsSubtitle" label="步骤区副标题" type="text" />
        </div>

        <div class="mt-3 space-y-3">
          <div v-for="(step, index) in form.steps" :key="index" class="border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs text-gray-500 font-semibold dark:text-gray-400">步骤 {{ index + 1 }}</span>
              <NButton size="tiny" quaternary type="error" @click="removeStep(index)">
                删除
              </NButton>
            </div>
            <BaseInput v-model="step.title" label="标题" type="text" />
            <BaseTextarea v-model="step.desc" label="描述" :rows="2" class="mt-3" />
          </div>
        </div>
      </section>

      <!-- 底部横幅与页脚 -->
      <section class="farm-card rounded-lg p-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-400">
            <span class="i-carbon-chat text-xl" />
          </div>
          <div>
            <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
              底部横幅与页脚
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              注册引导横幅与页脚声明文字
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput v-model="form.cta.title" label="横幅标题" type="text" />
          <BaseInput v-model="form.cta.subtitle" label="横幅副标题" type="text" />
          <BaseInput v-model="form.cta.primaryText" label="横幅主按钮文字" type="text" placeholder="立即注册" />
          <BaseInput v-model="form.cta.secondaryText" label="横幅次按钮文字" type="text" placeholder="登录面板" />
          <BaseTextarea v-model="form.footerNote" label="页脚声明" :rows="2" class="sm:col-span-2" />
        </div>
      </section>

      <div class="flex justify-end">
        <BaseButton variant="primary" :loading="saving" @click="handleSave">
          保存主页设置
        </BaseButton>
      </div>
    </template>
  </div>
</template>
