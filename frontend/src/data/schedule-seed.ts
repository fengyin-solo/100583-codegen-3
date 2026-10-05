import type {
  DutyPerson,
  HandoverTodo,
  ScheduleSheet,
  ScheduleState,
  ShiftSlot,
  SlotHistoryEntry,
  SwapRecord,
} from './schedule-types'

// 排班示例：一份已确认（含一笔已确认换班与交接待办）、一份已发布、一份缺岗位的草稿。
const POSTS = ['中控值守', '设备巡检', '现场巡查']
const SHIFT_DEFS = [
  { key: '白班', start: '08:00', end: '20:00' },
  { key: '夜班', start: '20:00', end: '08:00' },
]

const PEOPLE: DutyPerson[] = [
  { id: 1, name: '张建国' },
  { id: 2, name: '李永强' },
  { id: 3, name: '王海涛' },
  { id: 4, name: '刘志刚' },
  { id: 5, name: '陈志远' },
  { id: 6, name: '赵德胜' },
  { id: 7, name: '孙文斌' },
  { id: 8, name: '周立新' },
  { id: 9, name: '吴建平' },
]

type ShiftSeed = {
  date: string
  shift: string
  leader: string
  /** 与 POSTS 一一对应，空串表示岗位空缺 */
  posts: string[]
}

type SwapSeed = {
  date: string
  shift: string
  post: string
  toPerson: string
  reason: string
  requestedAt: string
  confirmedAt: string
}

type SheetSeed = {
  id: number
  name: string
  status: ScheduleSheet['status']
  startDate: string
  endDate: string
  createdAt: string
  publishedAt: string
  confirmedAt: string
  createdBy: string
  shifts: ShiftSeed[]
  swap?: SwapSeed
}

function slotId(sheetId: number, date: string, shift: string, part: string): string {
  return `s${sheetId}-${date}-${shift}-${part}`
}

function buildShift(sheet: SheetSeed, seed: ShiftSeed): ShiftSlot {
  const def = SHIFT_DEFS.find((item) => item.key === seed.shift) ?? SHIFT_DEFS[0]
  const isNightCrossDay = def.end === '08:00'
  const endDate = isNightCrossDay ? nextDay(seed.date) : seed.date
  const baseline = sheet.status === '草稿' ? '' : sheet.publishedAt
  const history: SlotHistoryEntry[] = []
  if (seed.leader) {
    history.push({
      at: sheet.createdAt,
      action: '编排',
      operator: sheet.createdBy,
      fromPerson: '',
      toPerson: seed.leader,
    })
  }
  const posts = POSTS.map((post, index) => {
    const assignee = seed.posts[index] ?? ''
    if (assignee) {
      history.push({
        at: sheet.createdAt,
        action: '编排',
        operator: sheet.createdBy,
        fromPerson: '',
        toPerson: assignee,
      })
    }
    return {
      id: slotId(sheet.id, seed.date, seed.shift, `p${index}`),
      post,
      assignee,
      effectiveSince: assignee ? baseline : '',
    }
  })
  return {
    id: slotId(sheet.id, seed.date, seed.shift, 'shift'),
    date: seed.date,
    shift: seed.shift,
    startAt: `${seed.date} ${def.start}`,
    endAt: `${endDate} ${def.end}`,
    leader: seed.leader,
    posts,
    history,
  }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function applySwap(sheet: ScheduleSheet, swaps: SwapRecord[], seq: { swap: number }): void {
  const seed = SWAPS_BY_SHEET[sheet.id]
  if (!seed) {
    return
  }
  const shift = sheet.shifts.find((item) => item.date === seed.date && item.shift === seed.shift)
  if (!shift) {
    return
  }
  const postSlot = shift.posts.find((item) => item.post === seed.post)
  if (!postSlot) {
    return
  }
  const fromPerson = postSlot.assignee
  seq.swap += 1
  swaps.push({
    id: seq.swap,
    sheetId: sheet.id,
    shiftId: shift.id,
    slotId: postSlot.id,
    date: seed.date,
    shift: seed.shift,
    post: seed.post,
    fromPerson,
    toPerson: seed.toPerson,
    reason: seed.reason,
    requestedBy: fromPerson,
    requestedAt: seed.requestedAt,
    confirmedBy: '张建国',
    confirmedAt: seed.confirmedAt,
    status: '已确认',
    rejectNote: '',
  })
  postSlot.assignee = seed.toPerson
  postSlot.effectiveSince = seed.confirmedAt
  shift.history.push({
    at: seed.confirmedAt,
    action: '换班确认',
    operator: '张建国',
    fromPerson,
    toPerson: seed.toPerson,
  })
}

const CREATED_BY = '张建国'

const SHEET_SEEDS: SheetSeed[] = [
  {
    id: 1,
    name: '2026年9月下旬汛期值班表',
    status: '已确认',
    startDate: '2026-09-25',
    endDate: '2026-09-27',
    createdAt: '2026-09-20 09:00',
    publishedAt: '2026-09-21 09:00',
    confirmedAt: '2026-09-22 09:00',
    createdBy: CREATED_BY,
    shifts: [
      { date: '2026-09-25', shift: '白班', leader: '张建国', posts: ['李永强', '王海涛', '刘志刚'] },
      { date: '2026-09-25', shift: '夜班', leader: '陈志远', posts: ['赵德胜', '孙文斌', '周立新'] },
      { date: '2026-09-26', shift: '白班', leader: '张建国', posts: ['赵德胜', '吴建平', '李永强'] },
      { date: '2026-09-26', shift: '夜班', leader: '陈志远', posts: ['王海涛', '刘志刚', '孙文斌'] },
      { date: '2026-09-27', shift: '白班', leader: '周立新', posts: ['吴建平', '赵德胜', '李永强'] },
      { date: '2026-09-27', shift: '夜班', leader: '张建国', posts: ['王海涛', '刘志刚', '陈志远'] },
    ],
    swap: {
      date: '2026-09-26',
      shift: '夜班',
      post: '中控值守',
      toPerson: '周立新',
      reason: '王海涛家中临时有事，申请让班',
      requestedAt: '2026-09-25 10:00',
      confirmedAt: '2026-09-25 15:30',
    },
  },
  {
    id: 2,
    name: '2026年10月上旬汛期值班表',
    status: '已发布',
    startDate: '2026-10-05',
    endDate: '2026-10-07',
    createdAt: '2026-09-28 09:00',
    publishedAt: '2026-10-01 09:00',
    confirmedAt: '',
    createdBy: CREATED_BY,
    shifts: [
      { date: '2026-10-05', shift: '白班', leader: '张建国', posts: ['李永强', '王海涛', '刘志刚'] },
      { date: '2026-10-05', shift: '夜班', leader: '陈志远', posts: ['赵德胜', '孙文斌', '周立新'] },
      { date: '2026-10-06', shift: '白班', leader: '张建国', posts: ['赵德胜', '吴建平', '李永强'] },
      { date: '2026-10-06', shift: '夜班', leader: '陈志远', posts: ['王海涛', '刘志刚', '孙文斌'] },
      { date: '2026-10-07', shift: '白班', leader: '周立新', posts: ['吴建平', '赵德胜', '王海涛'] },
      { date: '2026-10-07', shift: '夜班', leader: '张建国', posts: ['李永强', '陈志远', '刘志刚'] },
    ],
  },
  {
    id: 3,
    name: '2026年10月中旬汛期值班表',
    status: '草稿',
    startDate: '2026-10-12',
    endDate: '2026-10-14',
    createdAt: '2026-10-03 09:00',
    publishedAt: '',
    confirmedAt: '',
    createdBy: CREATED_BY,
    shifts: [
      { date: '2026-10-12', shift: '白班', leader: '张建国', posts: ['李永强', '王海涛', ''] },
      { date: '2026-10-13', shift: '白班', leader: '陈志远', posts: ['赵德胜', '孙文斌', '周立新'] },
    ],
  },
]

const SWAPS_BY_SHEET: Record<number, SwapSeed> = {
  1: SHEET_SEEDS[0].swap!,
}

function buildHandovers(sheet: ScheduleSheet): HandoverTodo[] {
  return sheet.shifts.map((shift, index) => ({
    id: index + 1,
    sheetId: sheet.id,
    shiftId: shift.id,
    date: shift.date,
    shift: shift.shift,
    leader: shift.leader,
    posts: shift.posts.map((post) => ({
      post: post.post,
      assignee: post.assignee,
      effectiveSince: post.effectiveSince,
    })),
    source: '排班确认自动带出',
    writtenAt: sheet.confirmedAt,
    status: index < 2 ? '已交接' : '待交接',
    handedBy: index < 2 ? '张建国' : '',
    handedAt: index < 2 ? '2026-09-25 20:05' : '',
  }))
}

export function buildSeedSchedule(): ScheduleState {
  const seq = { sheet: 3, swap: 0, handover: 0 }
  const sheets = SHEET_SEEDS.map((seed) => {
    const sheet: ScheduleSheet = {
      id: seed.id,
      name: seed.name,
      status: seed.status,
      startDate: seed.startDate,
      endDate: seed.endDate,
      shifts: seed.shifts.map((item) => buildShift(seed, item)),
      createdAt: seed.createdAt,
      publishedAt: seed.publishedAt,
      confirmedAt: seed.confirmedAt,
      createdBy: CREATED_BY,
    }
    return sheet
  })
  const swaps: SwapRecord[] = []
  const handovers: HandoverTodo[] = []
  for (const sheet of sheets) {
    if (SWAPS_BY_SHEET[sheet.id]) {
      applySwap(sheet, swaps, seq)
    }
    if (sheet.status === '已确认') {
      for (const todo of buildHandovers(sheet)) {
        seq.handover += 1
        todo.id = seq.handover
        handovers.push(todo)
      }
    }
  }
  return {
    people: PEOPLE,
    posts: POSTS,
    shifts: SHIFT_DEFS.map(({ key, start, end }) => ({ key, start, end })),
    sheets,
    swaps,
    handovers,
    seq,
  }
}
