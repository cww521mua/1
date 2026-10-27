<script setup lang="ts">
import axios from 'axios'
import { NButton } from 'naive-ui/es/button'
import { onMounted, ref } from 'vue'

/**
 * 视频教程页（公开访问）：主页「视频教程」入口进入，
 * 视频由管理员在面板后台维护（名称 + 播放链接，文件托管在外部视频服务）。
 */

interface VideoTutorial {
  id: string
  title: string
  url: string
  createdAt: number
}

const videos = ref<VideoTutorial[]>([])
const loading = ref(true)
const error = ref('')

function reloadPage() {
  window.location.reload()
}

onMounted(async () => {
  try {
    const res = await axios.get('/api/video-tutorials', { timeout: 8000 })
    const data = res.data && res.data.data
    videos.value = data && Array.isArray(data.videos) ? data.videos : []
  }
  catch {
    error.value = '视频教程加载失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="tutorials-page">
    <nav class="nav">
      <div class="nav-inner">
        <RouterLink class="brand" to="/">
          <span class="brand-back">←</span>
          <span class="brand-name">返回主页</span>
        </RouterLink>
        <NButton size="small" quaternary @click="reloadPage">
          刷新
        </NButton>
      </div>
    </nav>

    <main class="wrap">
      <header class="page-head">
        <h1>视频教程</h1>
        <p>跟着视频快速上手面板：添加账号、配置策略与日常使用</p>
      </header>

      <div v-if="loading" class="state-box">
        加载中…
      </div>
      <div v-else-if="error" class="state-box">
        {{ error }}
      </div>
      <div v-else-if="!videos.length" class="state-box">
        暂无视频教程，敬请期待
      </div>

      <div v-else class="video-grid">
        <section v-for="item in videos" :key="item.id" class="video-card">
          <video
            class="video-player"
            :src="item.url"
            controls
            preload="metadata"
            playsinline
            webkit-playsinline
          />
          <div class="video-meta">
            <h3 class="video-title">
              {{ item.title }}
            </h3>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.tutorials-page {
  /* 全局 html/body 为 overflow:hidden，页面自身承载滚动 */
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  color: var(--ui-ink);
  background-color: var(--ui-bg);
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
}

.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 1080px;
  margin: 0 auto;
  padding: 12px 18px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-ink);
  font-weight: 700;
  text-decoration: none;
}

.brand-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  font-size: 15px;
  color: var(--ui-primary);
  background: var(--ui-surface);
}

.brand-name {
  font-size: 14px;
}

.wrap {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 18px 48px;
}

.page-head {
  margin-bottom: 22px;
}

.page-head h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
}

.page-head p {
  margin: 6px 0 0;
  font-size: 13px;
  opacity: 0.65;
}

.state-box {
  padding: 56px 16px;
  border: 1px dashed var(--ui-border);
  border-radius: 18px;
  text-align: center;
  font-size: 14px;
  opacity: 0.65;
  background: color-mix(in srgb, var(--ui-surface) 55%, transparent);
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
  gap: 18px;
}

.video-card {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-surface) 88%, transparent);
  box-shadow: 0 18px 44px rgba(55, 75, 61, 0.10);
}

.video-player {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}

.video-meta {
  padding: 12px 14px 14px;
}

.video-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

@media (max-width: 480px) {
  .wrap {
    padding: 20px 12px 40px;
  }

  .page-head h1 {
    font-size: 22px;
  }

  .video-grid {
    grid-template-columns: 1fr;
  }
}
</style>
