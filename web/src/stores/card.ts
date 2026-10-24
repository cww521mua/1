import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useToastStore } from '@/stores/toast'

export type CardType = 'time' | 'quota'

export interface CardRecord {
  code: string
  description: string
  type: CardType
  days: number
  durationValue: number
  durationUnit: 'day' | 'hour'
  durationMs: number | null
  isPermanent: boolean
  value: number | null
  enabled: boolean
  createdAt: number
  usedBy: string
  usedByName: string
  usedAt: number | null
  purpose?: 'trial'
}

export interface CardSettings {
  enabled: boolean
  accountLimit: number
  trialEnabled: boolean
}

export interface CardOverview {
  settings: CardSettings
  accountCount: number
  availableTimeCards: number
}

export type NewCardType = CardType | 'trial'

export interface NewCardForm {
  description: string
  type: NewCardType
  durationValue: number
  durationUnit: 'day' | 'hour'
  isPermanent: boolean
  value: number
  count: number
}

export function getCardTypeLabel(card: Pick<CardRecord, 'type'>) {
  return card.type === 'quota' ? '额度' : '时间'
}

export function isTrialCard(card: Pick<CardRecord, 'purpose'>) {
  return card.purpose === 'trial'
}

export function formatCardValue(card: CardRecord) {
  if (card.type === 'quota')
    return `+${card.value ?? 0} 账号额度`
  if (card.isPermanent)
    return '永久'
  const unit = card.durationUnit === 'hour' ? '小时' : '天'
  return `${card.durationValue} ${unit}`
}

export function formatCardDate(timestamp: number | null | undefined) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function createDefaultForm(): NewCardForm {
  return {
    description: '',
    type: 'time',
    durationValue: 30,
    durationUnit: 'day',
    isPermanent: false,
    value: 1,
    count: 1,
  }
}

export const useCardStore = defineStore('card', () => {
  const toast = useToastStore()
  const cards = ref<CardRecord[]>([])
  const overview = ref<CardOverview>({ settings: { enabled: false, accountLimit: 0, trialEnabled: false }, accountCount: 0, availableTimeCards: 0 })
  const loading = ref(false)
  const newCardForm = ref<NewCardForm>(createDefaultForm())

  const unusedCount = computed(() => cards.value.filter(card => !card.usedBy).length)
  const usedCount = computed(() => cards.value.filter(card => !!card.usedBy).length)
  const enabledCount = computed(() => cards.value.filter(card => card.enabled).length)

  async function fetchCards() {
    loading.value = true
    try {
      const [cardsRes, overviewRes] = await Promise.all([
        api.get('/api/admin/cards'),
        api.get('/api/admin/cards/overview'),
      ])
      if (cardsRes.data?.ok)
        cards.value = Array.isArray(cardsRes.data.data) ? cardsRes.data.data : []
      if (overviewRes.data?.ok && overviewRes.data.data)
        overview.value = overviewRes.data.data
      return true
    }
    catch (error: any) {
      toast.error(getApiErrorMessage(error, '获取卡密列表失败'))
      return false
    }
    finally {
      loading.value = false
    }
  }

  async function createCards(payload: NewCardForm) {
    const description = payload.description.trim()
    if (!description)
      return { ok: false, error: '请输入卡密描述' }
    if (payload.type !== 'trial' && payload.type === 'time' && !payload.isPermanent && Number(payload.durationValue) <= 0)
      return { ok: false, error: '时间卡时长必须大于 0，永久卡请开启永久' }
    if (payload.type === 'quota' && Number(payload.value) <= 0)
      return { ok: false, error: '额度卡数量必须大于 0' }

    try {
      const { data } = await api.post('/api/admin/cards', payload.type === 'trial'
        ? {
            description,
            purpose: 'trial',
            count: Math.min(Math.max(Number(payload.count) || 1, 1), 100),
          }
        : {
            description,
            type: payload.type,
            durationValue: payload.type === 'time' ? (payload.isPermanent ? -1 : payload.durationValue) : undefined,
            durationUnit: payload.type === 'time' ? payload.durationUnit : undefined,
            isPermanent: payload.type === 'time' ? payload.isPermanent : undefined,
            value: payload.type === 'quota' ? payload.value : undefined,
            count: Math.min(Math.max(Number(payload.count) || 1, 1), 100),
          })
      if (!data?.ok)
        return { ok: false, error: getApiErrorMessage(data, '创建卡密失败') }
      const created: CardRecord[] = Array.isArray(data.data) ? data.data : [data.data]
      if (data.batch)
        exportCardsToText(created, `卡密导出_${description}_${formatDateForFile(Date.now())}.txt`)
      await fetchCards()
      return { ok: true, batch: !!data.batch, count: created.length }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '创建卡密失败') }
    }
  }

  async function toggleCard(card: CardRecord) {
    try {
      const { data } = await api.post(`/api/admin/cards/${card.code}`, { enabled: !card.enabled })
      if (!data?.ok)
        return { ok: false, error: getApiErrorMessage(data, '操作失败') }
      await fetchCards()
      return { ok: true }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '操作失败') }
    }
  }

  async function deleteCards(codes: string[]) {
    if (!codes.length)
      return { ok: false, error: '请先选择要删除的卡密' }
    try {
      const { data } = await api.post('/api/admin/cards/batch-delete', { codes })
      if (!data?.ok)
        return { ok: false, error: getApiErrorMessage(data, '删除卡密失败') }
      await fetchCards()
      return { ok: true, deletedCount: Number(data.deletedCount || 0), notFoundCount: Number(data.notFoundCount || 0) }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '删除卡密失败') }
    }
  }

  async function useCard(code: string, accountId?: string) {
    const normalized = String(code || '').trim().toUpperCase()
    if (!normalized)
      return { ok: false, error: '请输入卡密' }
    try {
      const { data } = await api.post('/api/admin/cards/use', { code: normalized, accountId: accountId || undefined })
      if (!data?.ok)
        return { ok: false, error: getApiErrorMessage(data, '核销失败') }
      await fetchCards()
      return { ok: true, cardType: data.data?.cardType as CardType | undefined }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '核销失败') }
    }
  }

  async function saveCardSettings(payload: Partial<CardSettings>) {
    try {
      const { data } = await api.post('/api/admin/cards/settings', payload)
      if (!data?.ok)
        return { ok: false, error: getApiErrorMessage(data, '保存失败') }
      if (data.data)
        overview.value = { ...overview.value, settings: data.data }
      return { ok: true }
    }
    catch (error: any) {
      return { ok: false, error: getApiErrorMessage(error, '保存失败') }
    }
  }

  function resetForm() {
    newCardForm.value = createDefaultForm()
  }

  return {
    cards,
    overview,
    loading,
    newCardForm,
    unusedCount,
    usedCount,
    enabledCount,
    fetchCards,
    createCards,
    toggleCard,
    deleteCards,
    useCard,
    saveCardSettings,
    resetForm,
  }
})

export function buildCardsExportText(cardsToExport: CardRecord[]) {
  return cardsToExport.map((card) => {
    const lines = [
      `卡密: ${card.code}`,
      `描述: ${card.description || '-'}`,
      `类型: ${getCardTypeLabel(card)}`,
      `数值: ${formatCardValue(card)}`,
      `状态: ${card.enabled ? '启用' : '禁用'}`,
    ]
    lines.push(card.usedBy ? `使用者: ${card.usedByName || card.usedBy}\n使用时间: ${formatCardDate(card.usedAt)}` : '未使用')
    lines.push(`创建时间: ${formatCardDate(card.createdAt)}`)
    return `${lines.join('\n')}\n${'='.repeat(40)}`
  }).join('\n\n')
}

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  document.execCommand('copy')
  document.body.removeChild(textArea)
  return true
}

export function exportCardsToText(cardsToExport: CardRecord[], filename?: string) {
  if (!cardsToExport.length)
    return
  const blob = new Blob([buildCardsExportText(cardsToExport)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
