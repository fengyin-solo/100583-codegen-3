import { defineStore } from 'pinia'

import type { Role } from '@/data/schedule-types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '张建国',
    role: '值班长' as Role,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isChief: (state) => state.role === '值班长',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(operator: string, role: Role) {
      this.operator = operator
      this.role = role
    },
  },
})
