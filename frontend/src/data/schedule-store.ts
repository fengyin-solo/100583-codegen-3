import { buildSeedSchedule } from './schedule-seed'
import type { ScheduleState } from './schedule-types'

// 排班模块单独存一份 localStorage，与通用台账互不影响。
const STORAGE_KEY = 'drainage-pump:schedule'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): ScheduleState {
  const fallback = buildSeedSchedule()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as ScheduleState
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: ScheduleState | null = null

export function scheduleState(): ScheduleState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function persistSchedule(state: ScheduleState): void {
  cache = clone(state)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export function resetSchedule(): ScheduleState {
  cache = buildSeedSchedule()
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
  return cache
}

export function scheduleStorageKey(): string {
  return STORAGE_KEY
}
