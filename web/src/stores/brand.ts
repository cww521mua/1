import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface BrandInfo {
  icon: string
  kicker: string
  title: string
  pageTitle: string
  purchaseText: string
  purchaseUrl: string
}

const DEFAULT_BRAND: BrandInfo = {
  icon: '',
  kicker: 'QQ FARM',
  title: 'QQ农场智能助手',
  pageTitle: '',
  purchaseText: '',
  purchaseUrl: '',
}

/**
 * 全局品牌配置：登录页、侧边栏与浏览器标签页标题共用一份。
 * /api/branding 为公开接口，登录前后都可加载。
 */
export const useBrandStore = defineStore('brand', () => {
  const brand = ref<BrandInfo>({ ...DEFAULT_BRAND })
  const loaded = ref(false)
  let pending: Promise<void> | null = null

  function applyTitle() {
    const title = brand.value.pageTitle || brand.value.title
    if (title)
      document.title = title
  }

  function apply(data: Partial<BrandInfo> | null | undefined) {
    if (data)
      brand.value = { ...brand.value, ...data }
    applyTitle()
    loaded.value = true
  }

  async function load(force = false) {
    if (loaded.value && !force)
      return
    if (!pending || force) {
      pending = api.get('/api/branding')
        .then(({ data }) => {
          if (data?.ok && data.data)
            apply(data.data)
        })
        .catch((e) => {
          console.error('获取品牌配置失败:', e)
        })
        .finally(() => {
          pending = null
        })
    }
    return pending
  }

  const iconUrl = computed(() => brand.value.icon.trim())
  const displayTitle = computed(() => brand.value.title || DEFAULT_BRAND.title)

  return { brand, loaded, load, apply, iconUrl, displayTitle }
})
