import { persistSchedule, resetSchedule, scheduleState } from '@/data/schedule-store'
import type {
  HandoverTodo,
  Role,
  ScheduleSheet,
  ScheduleState,
  ShiftSlot,
  SwapRecord,
} from '@/data/schedule-types'
export type Actor = { name: string; role: Role }

export type Result<T = void> = { ok: boolean; message: string; data?: T }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 本机当前时刻：新的人从确认那一刻起算，用的就是它。 */
export function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function mutate(): ScheduleState {
  // 深拷贝后改、再整体落盘，保证换班追加的历史不会被别处引用改坏。
  const next = clone(scheduleState())
  return next
}

function commit(state: ScheduleState): void {
  persistSchedule(state)
}

function findSheet(state: ScheduleState, sheetId: number): ScheduleSheet | undefined {
  return state.sheets.find((item) => item.id === sheetId)
}

function findShift(sheet: ScheduleSheet, shiftId: string): ShiftSlot | undefined {
  return sheet.shifts.find((item) => item.id === shiftId)
}

/** 值班长之外的身份改动一律退回：所有写操作先过这一关。 */
function requireChief(actor: Actor): Result<never> | null {
  if (actor.role !== '值班长') {
    return { ok: false, message: `当前身份「${actor.role}」为只读视图，改动已退回：只有值班长可以编排、发布与确认排班` }
  }
  return null
}

// ---------- 查询 ----------

export function listPeople(state: ScheduleState = scheduleState()): string[] {
  return state.people.map((item) => item.name)
}

export function listPosts(state: ScheduleState = scheduleState()): string[] {
  return state.posts
}

export function listSheets(state: ScheduleState = scheduleState()): ScheduleSheet[] {
  return [...state.sheets].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
}

export function listSwaps(sheetId: number, state: ScheduleState = scheduleState()): SwapRecord[] {
  return state.swaps
    .filter((item) => item.sheetId === sheetId)
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
}

export function listHandovers(
  sheetId?: number,
  state: ScheduleState = scheduleState(),
): HandoverTodo[] {
  const rows = sheetId
    ? state.handovers.filter((item) => item.sheetId === sheetId)
    : state.handovers
  return [...rows].sort((a, b) =>
    `${a.date} ${a.shift}` < `${b.date} ${b.shift}` ? 1 : -1,
  )
}

/** 一个班次里带班人+各岗位全部在岗才算齐，缺一个岗位就不允许发布。 */
export function missingPostsOf(shift: ShiftSlot): string[] {
  const missing: string[] = []
  if (!shift.leader.trim()) {
    missing.push('带班人')
  }
  for (const post of shift.posts) {
    if (!post.assignee.trim()) {
      missing.push(post.post)
    }
  }
  return missing
}

/** 同一个人在同一个班次里只能出现一次：返回重复的人名。 */
export function duplicatePeopleOf(shift: ShiftSlot): string[] {
  const names = [shift.leader, ...shift.posts.map((item) => item.assignee)].filter(Boolean)
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      dup.add(name)
    }
    seen.add(name)
  }
  return [...dup]
}

export function sheetIssues(sheet: ScheduleSheet): { shift: ShiftSlot; missing: string[]; duplicates: string[] }[] {
  return sheet.shifts
    .map((shift) => ({ shift, missing: missingPostsOf(shift), duplicates: duplicatePeopleOf(shift) }))
    .filter((item) => item.missing.length > 0 || item.duplicates.length > 0)
}

// ---------- 排班单 ----------

export function createSheet(
  input: { name: string; startDate: string; endDate: string },
  actor: Actor,
): Result<number> {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  if (!input.name.trim() || !input.startDate || !input.endDate) {
    return { ok: false, message: '排班名称和起止日期都要填写' }
  }
  if (input.startDate > input.endDate) {
    return { ok: false, message: '开始日期不能晚于结束日期' }
  }
  const state = mutate()
  state.seq.sheet += 1
  const id = state.seq.sheet
  const defs = state.shifts
  const shifts: ShiftSlot[] = []
  for (let cur = input.startDate; cur <= input.endDate; cur = addDay(cur, 1)) {
    for (const def of defs) {
      const endDate = def.key === '夜班' ? addDay(cur, 1) : cur
      shifts.push({
        id: `s${id}-${cur}-${def.key}-shift`,
        date: cur,
        shift: def.key,
        startAt: `${cur} ${def.start}`,
        endAt: `${endDate} ${def.end}`,
        leader: '',
        posts: state.posts.map((post, index) => ({
          id: `s${id}-${cur}-${def.key}-p${index}`,
          post,
          assignee: '',
          effectiveSince: '',
        })),
        history: [],
      })
    }
  }
  const ts = nowText()
  state.sheets.push({
    id,
    name: input.name.trim(),
    status: '草稿',
    startDate: input.startDate,
    endDate: input.endDate,
    shifts,
    createdAt: ts,
    publishedAt: '',
    confirmedAt: '',
    createdBy: actor.name,
  })
  commit(state)
  return { ok: true, message: `已生成空白排班单，共 ${shifts.length} 个班次待编排`, data: id }
}

/**
 * 排班提交：带班人或岗位派人。
 * - 重复提交同一个人到同一岗位：幂等，只保留一条，不再追加记录；
 * - 同一个人已在本班次别的岗位/带班：拒绝；
 * - 清空（assignee 传空串）只允许在草稿阶段。
 */
export function assignPerson(
  sheetId: number,
  shiftId: string,
  slotId: string,
  assignee: string,
  actor: Actor,
): Result {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  const state = mutate()
  const sheet = findSheet(state, sheetId)
  if (!sheet) {
    return { ok: false, message: '没有找到这张排班单' }
  }
  if (sheet.status === '已确认') {
    return { ok: false, message: '排班已确认并锁定，人员调整请走换班申请并留痕' }
  }
  const shift = findShift(sheet, shiftId)
  if (!shift) {
    return { ok: false, message: '没有找到这个班次' }
  }
  const isLeader = slotId === '__leader__'
  const postSlot = isLeader ? null : shift.posts.find((item) => item.id === slotId)
  if (!isLeader && !postSlot) {
    return { ok: false, message: '没有找到这个值守岗位' }
  }
  const target = assignee.trim()
  const current = isLeader ? shift.leader : postSlot!.assignee

  // 幂等：同一个人在同一班次同一岗位重复提交，只留一条。
  if (target === current) {
    return { ok: true, message: target ? `${target}已在该岗位，重复提交不再重复登记` : '该岗位本来就是空的' }
  }

  if (target) {
    const occupied =
      (!isLeader && shift.leader === target) ||
      (isLeader && shift.posts.some((item) => item.assignee === target)) ||
      shift.posts.some((item) => item.id !== slotId && item.assignee === target)
    if (occupied) {
      return { ok: false, message: `${target}已在「${shift.date} ${shift.shift}」的其他岗位，同一个班次只能出现一次` }
    }
  } else if (sheet.status === '已发布') {
    return { ok: false, message: '排班已发布，不能把岗位清空；如需调整请安排其他人或走换班' }
  }

  const ts = nowText()
  if (isLeader) {
    shift.leader = target
  } else {
    postSlot!.assignee = target
    postSlot!.effectiveSince = target ? (sheet.status === '已发布' ? ts : '') : ''
  }
  shift.history.push({
    at: ts,
    action: '编排',
    operator: actor.name,
    fromPerson: current,
    toPerson: target,
  })
  commit(state)
  return { ok: true, message: target ? `已安排 ${target} 到岗` : '已清空该岗位' }
}

export function publishSheet(sheetId: number, actor: Actor): Result {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  const state = mutate()
  const sheet = findSheet(state, sheetId)
  if (!sheet) {
    return { ok: false, message: '没有找到这张排班单' }
  }
  if (sheet.status === '已发布') {
    return { ok: false, message: '排班已经发布过了' }
  }
  if (sheet.status === '已确认') {
    return { ok: false, message: '排班已经确认，不能重复发布' }
  }
  const issues = sheetIssues(sheet)
  if (issues.length > 0) {
    const detail = issues
      .map((item) => {
        const parts: string[] = []
        if (item.missing.length) {
          parts.push(`缺${item.missing.join('、')}`)
        }
        if (item.duplicates.length) {
          parts.push(`${item.duplicates.join('、')}重复`)
        }
        return `${item.shift.date} ${item.shift.shift}（${parts.join('，')}）`
      })
      .join('；')
    return { ok: false, message: `有 ${issues.length} 个班次不齐，缺岗位的班次不允许发布：${detail}` }
  }
  const ts = nowText()
  sheet.status = '已发布'
  sheet.publishedAt = ts
  // 发布时把岗位人员的起算时刻补齐；草稿期间没有起算时刻。带班人的起算时刻以其最后一条编排/换班轨迹为准。
  for (const shift of sheet.shifts) {
    for (const post of shift.posts) {
      post.effectiveSince = ts
    }
  }
  commit(state)
  return { ok: true, message: '排班已发布：除值班长外，其他人打开将是只读视图' }
}

/**
 * 排班确认：锁定排班，并把结论回写到交接班的待交接清单。
 * 同一个班次只生成一条待办（按 shiftId 幂等），重复确认/换班回写都不会产生第二条。
 */
export function confirmSheet(sheetId: number, actor: Actor): Result {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  const state = mutate()
  const sheet = findSheet(state, sheetId)
  if (!sheet) {
    return { ok: false, message: '没有找到这张排班单' }
  }
  if (sheet.status === '草稿') {
    return { ok: false, message: '排班尚未发布，不能确认' }
  }
  if (sheet.status === '已确认') {
    return { ok: false, message: '排班已经确认，结论已回写交接班，无需重复操作' }
  }
  const issues = sheetIssues(sheet)
  if (issues.length > 0) {
    return { ok: false, message: '班次要员不齐，不能确认' }
  }
  const pendingSwaps = state.swaps.some(
    (item) => item.sheetId === sheetId && item.status === '待确认',
  )
  if (pendingSwaps) {
    return { ok: false, message: '还有换班申请没有处理完，先确认或退回再排班确认' }
  }
  const ts = nowText()
  sheet.status = '已确认'
  sheet.confirmedAt = ts
  for (const shift of sheet.shifts) {
    upsertHandover(state, sheet, shift, '排班确认自动带出', ts)
  }
  commit(state)
  return { ok: true, message: `排班已确认，${sheet.shifts.length} 个班次的交接结论已自动带到交接班待办` }
}

// ---------- 换班 ----------

/** 谁把班让给谁：当事人（任何在岗人员）都可以申请，确认动作仍只有值班长能做。 */
export function requestSwap(
  sheetId: number,
  shiftId: string,
  slotId: string,
  toPerson: string,
  reason: string,
  actor: Actor,
): Result<number> {
  const state = mutate()
  const sheet = findSheet(state, sheetId)
  if (!sheet) {
    return { ok: false, message: '没有找到这张排班单' }
  }
  if (sheet.status === '草稿') {
    return { ok: false, message: '草稿排班还没发布，直接改派即可，不用走换班' }
  }
  const shift = findShift(sheet, shiftId)
  if (!shift) {
    return { ok: false, message: '没有找到这个班次' }
  }
  const isLeader = slotId === '__leader__'
  const postSlot = isLeader ? null : shift.posts.find((item) => item.id === slotId)
  const fromPerson = isLeader ? shift.leader : postSlot?.assignee ?? ''
  const postName = isLeader ? '带班人' : postSlot!.post
  if (!fromPerson) {
    return { ok: false, message: '这个岗位还没人，不存在让班' }
  }
  const target = toPerson.trim()
  if (!target) {
    return { ok: false, message: '要写明把班让给谁' }
  }
  if (target === fromPerson) {
    return { ok: false, message: '让班对象不能是本人' }
  }
  const others = [shift.leader, ...shift.posts.map((item) => item.assignee)].filter(
    (name) => name && name !== fromPerson,
  )
  if (others.includes(target)) {
    return { ok: false, message: `${target}已在这个班次的其他岗位，一个班次只能出现一次` }
  }
  const active = state.swaps.find(
    (item) =>
      item.sheetId === sheetId &&
      item.shiftId === shiftId &&
      item.slotId === (isLeader ? '__leader__' : slotId) &&
      item.status === '待确认',
  )
  if (active) {
    return { ok: false, message: `这个岗位已有一笔待确认的换班申请（让给${active.toPerson}），先处理完再申请` }
  }
  state.seq.swap += 1
  const id = state.seq.swap
  state.swaps.push({
    id,
    sheetId,
    shiftId,
    slotId: isLeader ? '__leader__' : slotId,
    date: shift.date,
    shift: shift.shift,
    post: postName,
    fromPerson,
    toPerson: target,
    reason: reason.trim(),
    requestedBy: actor.name,
    requestedAt: nowText(),
    confirmedBy: '',
    confirmedAt: '',
    status: '待确认',
    rejectNote: '',
  })
  commit(state)
  return { ok: true, message: `换班申请已提交：${fromPerson} → ${target}，待值班长确认`, data: id }
}

/**
 * 确认换班：
 * - 原来那个人的历史记录不动，只追加一条「换班确认」；
 * - 新人的起算时刻 = 确认时刻；
 * - 若排班已确认，同步把最新结论回写到交接班待办。
 */
export function confirmSwap(swapId: number, actor: Actor): Result {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  const state = mutate()
  const swap = state.swaps.find((item) => item.id === swapId)
  if (!swap) {
    return { ok: false, message: '没有找到这笔换班申请' }
  }
  if (swap.status !== '待确认') {
    return { ok: false, message: `这笔换班已经${swap.status}，不能重复确认` }
  }
  const sheet = findSheet(state, swap.sheetId)
  const shift = sheet?.shifts.find((item) => item.id === swap.shiftId)
  if (!sheet || !shift) {
    return { ok: false, message: '换班对应的班次不存在' }
  }
  const others = [shift.leader, ...shift.posts.map((p) => p.assignee)].filter(
    (name) => name && name !== swap.fromPerson,
  )
  if (others.includes(swap.toPerson)) {
    return { ok: false, message: `${swap.toPerson}已在这个班次的其他岗位，确认后会同班重复` }
  }
  const ts = nowText()
  if (swap.slotId === '__leader__') {
    if (shift.leader !== swap.fromPerson) {
      return { ok: false, message: `带班人已不是 ${swap.fromPerson}，请核实后再处理` }
    }
    shift.leader = swap.toPerson
  } else {
    const postSlot = shift.posts.find((item) => item.id === swap.slotId)
    if (!postSlot || postSlot.assignee !== swap.fromPerson) {
      return { ok: false, message: `岗位人员已不是 ${swap.fromPerson}，请核实后再处理` }
    }
    postSlot.assignee = swap.toPerson
    postSlot.effectiveSince = ts
  }
  shift.history.push({
    at: ts,
    action: '换班确认',
    operator: actor.name,
    fromPerson: swap.fromPerson,
    toPerson: swap.toPerson,
  })
  swap.status = '已确认'
  swap.confirmedBy = actor.name
  swap.confirmedAt = ts
  if (sheet.status === '已确认') {
    upsertHandover(state, sheet, shift, `换班确认回写：${swap.fromPerson}→${swap.toPerson}`, ts)
  }
  commit(state)
  return { ok: true, message: `换班已确认：${swap.fromPerson} 让班给 ${swap.toPerson}，自 ${ts} 起由新人当班，原记录保留` }
}

export function rejectSwap(swapId: number, note: string, actor: Actor): Result {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  const state = mutate()
  const swap = state.swaps.find((item) => item.id === swapId)
  if (!swap) {
    return { ok: false, message: '没有找到这笔换班申请' }
  }
  if (swap.status !== '待确认') {
    return { ok: false, message: `这笔换班已经${swap.status}` }
  }
  swap.status = '已退回'
  swap.rejectNote = note.trim()
  swap.confirmedBy = actor.name
  swap.confirmedAt = nowText()
  const sheet = findSheet(state, swap.sheetId)
  const shift = sheet?.shifts.find((item) => item.id === swap.shiftId)
  if (shift) {
    shift.history.push({
      at: swap.confirmedAt,
      action: '换班退回',
      operator: actor.name,
      fromPerson: swap.fromPerson,
      toPerson: swap.toPerson,
    })
  }
  commit(state)
  return { ok: true, message: `换班申请已退回：${swap.fromPerson} → ${swap.toPerson}` }
}

// ---------- 交接班 ----------

/** 按班次幂等回写：同一班次在待交接清单里永远只有一条。 */
function upsertHandover(
  state: ScheduleState,
  sheet: ScheduleSheet,
  shift: ShiftSlot,
  source: string,
  ts: string,
): void {
  const existing = state.handovers.find((item) => item.shiftId === shift.id)
  const payload = {
    leader: shift.leader,
    posts: shift.posts.map((post) => ({
      post: post.post,
      assignee: post.assignee,
      effectiveSince: post.effectiveSince,
    })),
  }
  if (existing) {
    existing.leader = payload.leader
    existing.posts = payload.posts
    existing.source = source
    existing.writtenAt = ts
    return
  }
  state.seq.handover += 1
  state.handovers.push({
    id: state.seq.handover,
    sheetId: sheet.id,
    shiftId: shift.id,
    date: shift.date,
    shift: shift.shift,
    leader: payload.leader,
    posts: payload.posts,
    source,
    writtenAt: ts,
    status: '待交接',
    handedBy: '',
    handedAt: '',
  })
}

export function completeHandover(handoverId: number, actor: Actor): Result {
  const guard = requireChief(actor)
  if (guard) {
    return guard
  }
  const state = mutate()
  const todo = state.handovers.find((item) => item.id === handoverId)
  if (!todo) {
    return { ok: false, message: '没有找到这条交接待办' }
  }
  if (todo.status === '已交接') {
    return { ok: false, message: '该班次已经完成交接' }
  }
  todo.status = '已交接'
  todo.handedBy = actor.name
  todo.handedAt = nowText()
  commit(state)
  return { ok: true, message: `${todo.date} ${todo.shift} 已完成交接班` }
}

// ---------- 跨天 / 连班识别 ----------

export type Continuity = {
  crossDay: boolean
  /** 与紧邻的上一班（前一天夜班或当天白班）同一人连班 */
  backToBackWith: ShiftSlot | null
}

export function continuityMap(sheet: ScheduleSheet): Map<string, Continuity> {
  const byDate = new Map<string, { day?: ShiftSlot; night?: ShiftSlot }>()
  for (const shift of sheet.shifts) {
    const cell = byDate.get(shift.date) ?? {}
    if (shift.shift === '夜班') {
      cell.night = shift
    } else {
      cell.day = shift
    }
    byDate.set(shift.date, cell)
  }
  const result = new Map<string, Continuity>()
  for (const shift of sheet.shifts) {
    const crossDay = shift.endAt.slice(0, 10) !== shift.date
    let prev: ShiftSlot | null = null
    if (shift.shift === '夜班') {
      prev = byDate.get(shift.date)?.day ?? null
    } else {
      prev = byDate.get(addDay(shift.date, -1))?.night ?? null
    }
    const backToBackWith =
      prev && sharesPerson(prev, shift) ? prev : null
    result.set(shift.id, { crossDay, backToBackWith })
  }
  return result
}

function peopleOf(shift: ShiftSlot): Set<string> {
  return new Set([shift.leader, ...shift.posts.map((item) => item.assignee)].filter(Boolean))
}

function sharesPerson(a: ShiftSlot, b: ShiftSlot): boolean {
  const bPeople = peopleOf(b)
  return [...peopleOf(a)].some((name) => bPeople.has(name))
}

// ---------- 其它 ----------

export function resetScheduleData(): Result {
  resetSchedule()
  return { ok: true, message: '排班示例数据已重置' }
}

function addDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + delta)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
