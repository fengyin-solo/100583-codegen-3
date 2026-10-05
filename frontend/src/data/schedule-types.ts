/** 排班与交接班模块的领域模型：排班单、班次、岗位、换班留痕、交接班待办。 */

export type ScheduleStatus = '草稿' | '已发布' | '已确认'

export type SwapStatus = '待确认' | '已确认' | '已退回'

/** 可登录身份：只有值班长能改动已发布的排班，其余人一律只读。 */
export type Role = '值班长' | '值班员'

/** 值守岗位：带班人单独指定，其余按岗位占位，岗位不填满不允许发布。 */
export type PostSlot = {
  id: string
  post: string
  assignee: string
  /** 该岗位当前值班人从什么时刻起算；原始排班用发布/确认时刻，换班用确认时刻。 */
  effectiveSince: string
}

/** 岗位人员的变更轨迹：换班只追加，不覆盖原记录，保证「原来那个人的记录不动」。 */
export type SlotHistoryEntry = {
  at: string
  action: '编排' | '换班确认' | '换班退回'
  operator: string
  fromPerson: string
  toPerson: string
}

export type ShiftSlot = {
  id: string
  date: string
  /** 班次，如 白班 / 夜班 */
  shift: string
  /** 班次起始时刻（YYYY-MM-DD HH:mm），用于跨天、连班判断 */
  startAt: string
  /** 班次结束时刻；夜班结束在次日，即跨天 */
  endAt: string
  leader: string
  posts: PostSlot[]
  history: SlotHistoryEntry[]
}

export type ScheduleSheet = {
  id: number
  name: string
  status: ScheduleStatus
  startDate: string
  endDate: string
  shifts: ShiftSlot[]
  createdAt: string
  publishedAt: string
  confirmedAt: string
  createdBy: string
}

/** 换班申请：谁把班让给谁、谁确认的、什么时候确认的，全部留痕。 */
export type SwapRecord = {
  id: number
  sheetId: number
  shiftId: string
  slotId: string
  date: string
  shift: string
  post: string
  fromPerson: string
  toPerson: string
  reason: string
  requestedBy: string
  requestedAt: string
  confirmedBy: string
  confirmedAt: string
  status: SwapStatus
  rejectNote: string
}

/** 交接班待办：排班确认时按班次自动带出，换班确认后同步回写结论。 */
export type HandoverTodo = {
  id: number
  sheetId: number
  shiftId: string
  date: string
  shift: string
  leader: string
  /** 待交接岗位结论：带班人 + 各值守岗位当班人 */
  posts: { post: string; assignee: string; effectiveSince: string }[]
  source: string
  writtenAt: string
  status: '待交接' | '已交接'
  handedBy: string
  handedAt: string
}

export type DutyPerson = { id: number; name: string }

export type ScheduleState = {
  people: DutyPerson[]
  posts: string[]
  shifts: { key: string; start: string; end: string }[]
  sheets: ScheduleSheet[]
  swaps: SwapRecord[]
  handovers: HandoverTodo[]
  seq: { sheet: number; swap: number; handover: number }
}
