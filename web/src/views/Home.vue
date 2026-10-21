<script setup lang="ts">
import axios from 'axios'
import { NModal } from 'naive-ui/es/modal'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStorage } from '@vueuse/core'
import { getHomeIcon } from '@/constants/home-icons'
import Login from '@/views/Login.vue'

interface HomeFeature { icon: string, title: string, desc: string }
interface HomeStep { title: string, desc: string }
interface HomePageData {
  brandName: string
  hero: { kicker: string, title1: string, title2: string, highlight: string, description: string, primaryText: string, secondaryText: string, chips: string[] }
  featuresTitle: string
  featuresSubtitle: string
  features: HomeFeature[]
  stepsTitle: string
  stepsSubtitle: string
  steps: HomeStep[]
  cta: { title: string, subtitle: string, primaryText: string, secondaryText: string }
  footerNote: string
}

// 接口异常时的兜底展示内容（与后端默认配置一致）
const FALLBACK: HomePageData = {
  brandName: 'QQ 农场挂机面板',
  hero: {
    kicker: '多账号 · 全自动 · 液态玻璃面板',
    title1: '多账号挂机，',
    title2: '把农场交给全自动',
    highlight: '交给全自动',
    description: '基于 Web 面板的 QQ 农场自动化工具：多账号独立策略、全自动种收偷菜、好友互动、图鉴收集、活动中心与收益分析一站管理。',
    primaryText: '立即注册',
    secondaryText: '查看功能',
    chips: ['全天候自动化', '账号数据独立', '移动端适配', '离线提醒推送'],
  },
  featuresTitle: '从种植到收益，一站托管',
  featuresSubtitle: '覆盖 QQ 农场日常与活动的完整自动化链路，全部操作在 Web 面板完成。',
  features: [
    { icon: 'account', title: '多账号独立挂机', desc: '游戏账号独立运行，策略互不干扰。' },
    { icon: 'plant', title: '农场全自动', desc: '收获、种植、施肥、除虫全自动执行。' },
    { icon: 'bolt', title: '等级加速', desc: '一键执行 QQ 等级任务，支持定时自动执行。' },
  ],
  stepsTitle: '三步开始挂机',
  stepsSubtitle: '注册后添加游戏账号并配置策略，剩下的交给面板自动完成。',
  steps: [
    { title: '注册账号', desc: '创建面板账号并登录。' },
    { title: '添加游戏账号', desc: '多种登录方式任选。' },
    { title: '自动挂机', desc: '面板全天候托管。' },
  ],
  cta: { title: '现在注册，让农场自己运转', subtitle: '注册即开即用，手机电脑随时掌控。', primaryText: '立即注册', secondaryText: '登录面板' },
  footerNote: '本工具仅供学习与技术交流，请合理使用并遵守游戏服务协议。',
}

const adminToken = useStorage('admin_token', '')
const cfg = ref<HomePageData>({ ...FALLBACK })
const brandIcon = ref('')
const brandTitle = ref('')
const brandIconFailed = ref(false)
const loading = ref(true)

const isLoggedIn = computed(() => !!String(adminToken.value || '').trim())

const navBrandName = computed(() => cfg.value.brandName || brandTitle.value || FALLBACK.brandName)

// 登录/注册弹窗：主页内完成登录，成功后跳转 /dashboard（Login.vue 处理）
const route = useRoute()
const router = useRouter()
const authModal = ref<'login' | 'register' | null>(null)

function openAuth(mode: 'login' | 'register') {
  authModal.value = mode
}

function closeAuth() {
  authModal.value = null
}

const highlightParts = computed(() => {
  const title2 = cfg.value.hero.title2 || ''
  const highlight = (cfg.value.hero.highlight || '').trim()
  if (!highlight || !title2.includes(highlight))
    return { before: title2, mark: '', after: '' }
  const index = title2.indexOf(highlight)
  return { before: title2.slice(0, index), mark: highlight, after: title2.slice(index + highlight.length) }
})

let observer: IntersectionObserver | null = null

function iconPath(key: string) {
  return getHomeIcon(key).path
}

function scrollToFeatures() {
  document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
}

onMounted(async () => {
  // 未登录被重定向回主页时（/dashboard 等 → /?auth=login），自动弹出登录框
  if (String(route.query.auth || '') === 'login' && !isLoggedIn.value) {
    authModal.value = 'login'
    router.replace({ query: { ...route.query, auth: undefined } })
  }

  const requests: Promise<any>[] = [
    axios.get('/api/home-page', { timeout: 8000 }).then((res) => {
      const data = res.data && res.data.data
      if (data && typeof data === 'object')
        cfg.value = { ...FALLBACK, ...data, hero: { ...FALLBACK.hero, ...(data.hero || {}) }, cta: { ...FALLBACK.cta, ...(data.cta || {}) } }
    }).catch(() => {}),
    axios.get('/api/branding', { timeout: 8000 }).then((res) => {
      const data = res.data && res.data.data
      if (data && typeof data === 'object') {
        brandIcon.value = String(data.icon || '')
        brandTitle.value = String(data.title || '')
      }
    }).catch(() => {}),
  ]
  await Promise.all(requests)
  loading.value = false
  await nextTick()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in')
        observer?.unobserve(entry.target)
      }
    }
  }, { threshold: 0.12 })
  document.querySelectorAll('.reveal').forEach(el => observer?.observe(el))
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="home-page">
    <!-- 顶部导航：右上角登录 / 注册 -->
    <nav class="nav">
      <div class="nav-inner">
        <a class="brand" href="/">
          <img v-if="brandIcon && !brandIconFailed" :src="brandIcon" alt="logo" class="brand-img" @error="brandIconFailed = true">
          <svg v-else class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
            <rect width="48" height="48" rx="13" fill="#438d63" />
            <path d="M24 37c0-8 2.2-13.4 9-16.6-.4 7.6-3 12.8-9 16.6Z" fill="#dff0e2" />
            <path d="M24 37c0-8-2.2-13.4-9-16.6.4 7.6 3 12.8 9 16.6Z" fill="#a9d8b5" />
            <rect x="22.7" y="30" width="2.6" height="8" rx="1.3" fill="#eef7ef" />
          </svg>
          <span class="brand-name">{{ navBrandName }}</span>
        </a>
        <div class="nav-actions">
          <template v-if="!isLoggedIn">
            <button class="btn btn-ghost" @click="openAuth('login')">登录</button>
            <button class="btn btn-primary" @click="openAuth('register')">立即注册</button>
          </template>
          <RouterLink v-else class="btn btn-primary" to="/dashboard">进入面板</RouterLink>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <header class="hero">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <span class="kicker">{{ cfg.hero.kicker }}</span>
          <h1>{{ cfg.hero.title1 }}<br>{{ highlightParts.before }}<em v-if="highlightParts.mark">{{ highlightParts.mark }}</em>{{ highlightParts.after }}</h1>
          <p>{{ cfg.hero.description }}</p>
          <div class="hero-cta">
            <button v-if="!isLoggedIn" class="btn btn-primary btn-lg" @click="openAuth('register')">
              {{ cfg.hero.primaryText || '立即注册' }}
            </button>
            <RouterLink v-else class="btn btn-primary btn-lg" to="/dashboard">进入面板</RouterLink>
            <button class="btn btn-ghost btn-lg" @click="scrollToFeatures">{{ cfg.hero.secondaryText }}</button>
          </div>
          <div class="hero-chips">
            <span v-for="chip in cfg.hero.chips" :key="chip" class="chip">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 12.5 2 8l1.4-1.4 3.1 3.1 6.1-6.1L14 5z" /></svg>
              {{ chip }}
            </span>
          </div>
        </div>

        <div class="hero-visual">
          <div class="panel-card" role="img" aria-label="面板界面示意">
            <div class="panel-top">
              <i class="panel-dot" /><i class="panel-dot" /><i class="panel-dot" />
              <span>农场概览 · 实时状态</span>
            </div>
            <div class="panel-row">
              <span class="panel-ico" style="background: var(--ui-primary-soft); color: var(--ui-primary)">
                <svg viewBox="0 0 16 16" fill="currentColor"><path :d="iconPath('plant')" /></svg>
              </span>
              <div class="panel-meta">
                <b>3 号地块 · 冬小麦</b>
                <small>成熟倒计时 00:42:18 · 已自动施肥</small>
                <div class="bar"><i style="width: 78%" /></div>
              </div>
              <span class="panel-badge" style="background: var(--ui-primary-soft); color: var(--ui-primary)">生长中</span>
            </div>
            <div class="panel-row">
              <span class="panel-ico" style="background: var(--hp-teal-soft); color: var(--ui-teal)">
                <svg viewBox="0 0 16 16" fill="currentColor"><path :d="iconPath('friends')" /></svg>
              </span>
              <div class="panel-meta">
                <b>好友巡查 · 106 位好友</b>
                <small>偷菜 / 帮忙 / 捣乱一次完成 · 黑名单已过滤</small>
                <div class="bar"><i style="width: 52%; background: var(--ui-teal)" /></div>
              </div>
              <span class="panel-badge" style="background: var(--hp-teal-soft); color: var(--ui-teal)">巡查中</span>
            </div>
            <div class="panel-row">
              <span class="panel-ico" style="background: var(--ui-warning-soft); color: var(--ui-warning)">
                <svg viewBox="0 0 16 16" fill="currentColor"><path :d="iconPath('star')" /></svg>
              </span>
              <div class="panel-meta">
                <b>每日礼包 · 已领取 6 项</b>
                <small>汇总任务 / 分享 / 月卡 / 图鉴奖励按天处理</small>
              </div>
              <span class="panel-badge" style="background: var(--ui-warning-soft); color: var(--ui-warning)">已完成</span>
            </div>
            <div class="panel-row">
              <span class="panel-ico" style="background: var(--ui-blue-soft); color: var(--ui-blue)">
                <svg viewBox="0 0 16 16" fill="currentColor"><path :d="iconPath('chart')" /></svg>
              </span>
              <div class="panel-meta">
                <b>收益分析 · 本周金币 +24.6%</b>
                <small>作物收益对比 · 策略预览 · 批量黑名单</small>
                <div class="bar"><i style="width: 64%; background: var(--ui-blue)" /></div>
              </div>
              <span class="panel-badge" style="background: var(--ui-blue-soft); color: var(--ui-blue)">统计中</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- 功能 -->
    <section id="features">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="kicker">FEATURES</span>
          <h2>{{ cfg.featuresTitle }}</h2>
          <p>{{ cfg.featuresSubtitle }}</p>
        </div>
        <div class="feat-grid">
          <div v-for="feat in cfg.features" :key="feat.title" class="feat reveal">
            <span class="feat-ico" :style="{ background: 'var(--hp-icon-soft, var(--ui-primary-soft))', color: 'var(--hp-icon-color, var(--ui-primary))' }">
              <svg viewBox="0 0 16 16" fill="currentColor"><path :d="iconPath(feat.icon)" /></svg>
            </span>
            <h3>{{ feat.title }}</h3>
            <p>{{ feat.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 使用步骤 -->
    <section style="padding-top: 0">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="kicker">HOW IT WORKS</span>
          <h2>{{ cfg.stepsTitle }}</h2>
          <p>{{ cfg.stepsSubtitle }}</p>
        </div>
        <div class="steps">
          <div v-for="(step, index) in cfg.steps" :key="step.title" class="step reveal">
            <span class="step-no">0{{ index + 1 }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 底部 CTA -->
    <section style="padding-top: 0">
      <div class="wrap">
        <div class="cta-band reveal">
          <h2>{{ cfg.cta.title }}</h2>
          <p>{{ cfg.cta.subtitle }}</p>
          <div class="hero-cta">
            <button v-if="!isLoggedIn" class="btn btn-primary btn-lg" @click="openAuth('register')">
              {{ cfg.cta.primaryText || '立即注册' }}
            </button>
            <RouterLink v-else class="btn btn-primary btn-lg" to="/dashboard">进入面板</RouterLink>
            <button class="btn btn-ghost btn-lg" @click="openAuth('login')">{{ cfg.cta.secondaryText || '登录面板' }}</button>
          </div>
        </div>
      </div>
    </section>

    <footer>
      <div class="wrap foot-inner">
        <div class="foot-brand">
          <svg viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#438d63" /><path d="M24 37c0-8 2.2-13.4 9-16.6-.4 7.6-3 12.8-9 16.6Z" fill="#dff0e2" /><path d="M24 37c0-8-2.2-13.4-9-16.6.4 7.6 3 12.8 9 16.6Z" fill="#a9d8b5" /><rect x="22.7" y="30" width="2.6" height="8" rx="1.3" fill="#eef7ef" /></svg>
          <b>{{ navBrandName }}</b>
        </div>
        <div class="foot-links">
          <template v-if="!isLoggedIn">
            <a href="#" @click.prevent="openAuth('login')">登录</a>
            <a href="#" @click.prevent="openAuth('register')">注册</a>
          </template>
          <RouterLink v-else to="/dashboard">进入面板</RouterLink>
          <a href="#features" @click.prevent="scrollToFeatures">功能</a>
        </div>
        <p class="foot-note">{{ cfg.footerNote }}</p>
      </div>
    </footer>

    <!-- 登录 / 注册弹窗 -->
    <NModal
      :show="!!authModal"
      :mask-closable="true"
      @update:show="value => !value && closeAuth()"
    >
      <div class="auth-modal">
        <button class="auth-close" aria-label="关闭" @click="closeAuth">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.7 2.3 8 6.6l4.3-4.3 1.4 1.4L9.4 8l4.3 4.3-1.4 1.4L8 9.4l-4.3 4.3-1.4-1.4L6.6 8 2.3 3.7z" /></svg>
        </button>
        <Login v-if="authModal" :key="authModal" embedded :initial-mode="authModal" />
      </div>
    </NModal>
  </div>
</template>

<style scoped>
/* 主页为对外展示页，固定浅色；局部补充全局没有的 soft 色 */
.home-page {
  --hp-teal-soft: #e6f2f0;
  --hp-violet-soft: var(--ui-violet-soft);
  --hp-icon-soft: var(--ui-primary-soft);
  --hp-icon-color: var(--ui-primary);
  position: relative;
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  color: var(--ui-ink);
  background:
    radial-gradient(1100px 520px at 0% 0%, var(--ui-bg-glow), transparent 70%),
    radial-gradient(900px 480px at 100% 100%, var(--ui-bg-glow-2), transparent 70%),
    var(--ui-bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.home-page a { color: inherit; text-decoration: none; }

/* ---------- 顶部导航 ---------- */
.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
  box-shadow: 0 1px 0 var(--ui-border);
  -webkit-backdrop-filter: var(--chrome-blur);
  backdrop-filter: var(--chrome-blur);
}
.nav-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 14px 22px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-right: auto;
  min-width: 0;
}
.brand-img,
.brand-mark {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 10px;
  object-fit: cover;
  box-shadow: 0 6px 14px rgba(45, 122, 83, 0.2);
}
.brand-mark { border-radius: 0; filter: drop-shadow(0 6px 14px rgba(45, 122, 83, 0.24)); }
.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

/* ---------- 按钮 ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  padding: 0 18px;
  border-radius: var(--ui-radius-control);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.btn:active { transform: translateY(1px); }
.btn-primary {
  color: #fff;
  background: var(--ui-primary);
  box-shadow: 0 8px 20px rgba(67, 141, 99, 0.32);
}
.btn-primary:hover { background: color-mix(in srgb, var(--ui-primary) 88%, #000); }
.btn-ghost {
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  border-color: var(--ui-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--ui-shadow-sm);
}
.btn-ghost:hover { border-color: var(--ui-border-strong); }
.btn-lg { height: 46px; padding: 0 26px; font-size: 15px; }

/* ---------- 通用布局 ---------- */
.wrap {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 22px;
}

section { padding: 72px 0; }

.kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 13px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-surface-strong) 70%, transparent);
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.kicker::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-primary);
  box-shadow: 0 0 0 3px rgba(67, 141, 99, 0.18);
}

.sec-head { text-align: center; max-width: 640px; margin: 0 auto 42px; }
.sec-head h2 {
  margin: 14px 0 10px;
  font-size: clamp(24px, 3.4vw, 32px);
  line-height: 1.25;
  letter-spacing: 0;
}
.sec-head p { margin: 0; color: var(--ui-muted); font-size: 15px; line-height: 1.7; }

/* ---------- Hero ---------- */
.hero {
  position: relative;
  padding: 64px 0 76px;
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
}
.hero::before {
  content: '';
  position: absolute;
  inset: 32px 6% 24px;
  border: 1px solid rgba(67, 141, 99, 0.08);
  border-radius: 36px;
  background: color-mix(in srgb, var(--ui-surface-strong) 22%, transparent);
  pointer-events: none;
}
.hero-grid {
  position: relative;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 48px;
  align-items: center;
}
.hero-copy h1 {
  margin: 18px 0 16px;
  font-size: clamp(30px, 4.6vw, 46px);
  line-height: 1.22;
  letter-spacing: 0;
}
.hero-copy h1 em {
  font-style: normal;
  color: var(--ui-primary);
}
.hero-copy > p {
  margin: 0 0 26px;
  color: var(--ui-muted);
  font-size: 16px;
  line-height: 1.8;
  max-width: 480px;
}
.hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 30px; }
.hero-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-surface-strong) 66%, transparent);
  color: var(--ui-muted);
  font-size: 12.5px;
  font-weight: 600;
}
.chip svg { width: 13px; height: 13px; color: var(--ui-primary); }

/* Hero 右侧：面板玻璃模拟卡片 */
.hero-visual { position: relative; }
.panel-card {
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-bg) 82%, transparent);
  box-shadow: 0 28px 76px rgba(55, 75, 61, 0.16), inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
  padding: 18px;
}
.panel-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ui-border);
}
.panel-dot { width: 9px; height: 9px; border-radius: 50%; }
.panel-dot:nth-child(1) { background: #dcd6c3; }
.panel-dot:nth-child(2) { background: #cfe3d4; }
.panel-dot:nth-child(3) { background: #bcd9c6; }
.panel-top span {
  margin-left: 6px;
  color: var(--ui-subtle);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.panel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 4px;
  border-bottom: 1px dashed var(--ui-border);
}
.panel-row:last-child { border-bottom: 0; }
.panel-ico {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
}
.panel-ico svg { width: 17px; height: 17px; }
.panel-meta { flex: 1; min-width: 0; }
.panel-meta b { display: block; font-size: 13px; font-weight: 650; }
.panel-meta small { color: var(--ui-subtle); font-size: 11.5px; }
.panel-badge {
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.bar {
  margin-top: 5px;
  height: 5px;
  border-radius: 999px;
  background: rgba(58, 86, 68, 0.08);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--ui-primary);
  animation: hp-bar-grow 1.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes hp-bar-grow {
  from { width: 0; }
}

/* ---------- 功能区 ---------- */
.feat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.feat {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--ui-shadow-sm);
  padding: 22px;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.feat:hover {
  transform: translateY(-3px);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--ui-shadow-md);
  border-color: var(--ui-border-strong);
}
.feat-ico {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  margin-bottom: 14px;
}
.feat-ico svg { width: 21px; height: 21px; }
.feat h3 { margin: 0 0 8px; font-size: 16px; letter-spacing: 0; }
.feat p { margin: 0; color: var(--ui-muted); font-size: 13.5px; line-height: 1.75; }

/* ---------- 使用步骤 ---------- */
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.step {
  position: relative;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--ui-shadow-sm);
  padding: 24px 22px 22px;
}
.step-no {
  display: block;
  color: var(--ui-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 2px;
  margin-bottom: 10px;
}
.step h3 { margin: 0 0 8px; font-size: 16px; }
.step p { margin: 0; color: var(--ui-muted); font-size: 13.5px; line-height: 1.75; }

/* ---------- 底部 CTA ---------- */
.cta-band {
  border: 1px solid var(--ui-border);
  border-radius: 22px;
  background:
    radial-gradient(600px 220px at 15% 0%, rgba(67, 141, 99, 0.14), transparent 70%),
    color-mix(in srgb, var(--ui-bg) 82%, transparent);
  box-shadow: 0 28px 76px rgba(55, 75, 61, 0.14), inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
  padding: 46px 40px;
  text-align: center;
}
.cta-band h2 { margin: 0 0 10px; font-size: clamp(22px, 3.2vw, 30px); }
.cta-band p { margin: 0 0 24px; color: var(--ui-muted); font-size: 15px; }
.cta-band .hero-cta { justify-content: center; margin-bottom: 0; }

/* ---------- 页脚 ---------- */
footer { padding: 48px 0 40px; }
.foot-inner {
  border-top: 1px solid var(--ui-border);
  padding-top: 26px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}
.foot-brand { display: flex; align-items: center; gap: 9px; margin-right: auto; }
.foot-brand svg { width: 26px; height: 26px; }
.foot-brand b { font-size: 14px; }
.foot-links { display: flex; gap: 18px; font-size: 13px; color: var(--ui-muted); }
.foot-links a:hover { color: var(--ui-primary); }
.foot-note {
  flex-basis: 100%;
  margin: 0;
  color: var(--ui-subtle);
  font-size: 12px;
  line-height: 1.7;
}

/* ---------- 登录 / 注册弹窗 ---------- */
.auth-modal {
  position: relative;
  width: min(478px, 92vw);
  padding: 6px;
  border-radius: 20px;
}
.auth-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-surface-strong) 85%, transparent);
  color: var(--ui-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.auth-close:hover { color: var(--ui-ink); border-color: var(--ui-border-strong); }
.auth-close svg { width: 13px; height: 13px; }

/* ---------- 入场动画 ---------- */
.reveal { opacity: 0; transform: translateY(18px); transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1); }
.reveal.in { opacity: 1; transform: none; }

/* ---------- 响应式 ---------- */
@media (max-width: 920px) {
  .hero-grid { grid-template-columns: 1fr; gap: 36px; }
  .hero-visual { max-width: 480px; margin: 0 auto; }
  .feat-grid, .steps { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 620px) {
  section { padding: 52px 0; }
  .hero { padding: 40px 0 56px; }
  .hero::before { inset: 16px 4% 12px; }
  .feat-grid, .steps { grid-template-columns: 1fr; }
  .nav-actions :deep(.btn) { height: 36px; padding: 0 13px; font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .home-page { scroll-behavior: auto; }
  .home-page :deep(*),
  .home-page *::before,
  .home-page *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .reveal { opacity: 1; transform: none; }
}
</style>
