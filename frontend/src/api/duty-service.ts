import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 汛期排班的专用业务层：通用增删改查套不下「缺岗位禁发布、换班留痕、确认回写交接」这些规矩，
// 所以排班、换班、交接的读写都收在这里，页面只负责展示和收集输入。
export const SHIFT_KEY = 'dutyschedule'
export const ASSIGN_KEY = 'dutyassign'
export const SWAP_KEY = 'dutyswap'
export const HANDOVER_KEY = 'handover'

export const CHIEF_ROLE = '值班长'
export const LEADER_POST = '带班人'
export const REQUIRED_POSTS = ['泵站值守', '调度值守', '抢险待命']
export const ALL_POSTS = [LEADER_POST, ...REQUIRED_POSTS]
export const SHIFT_NAMES = ['白班', '夜班']

export type AssignmentView = {
  id: number
  岗位: string
  值班人: string
  来源: string
  生效时间: string
}

export type ShiftView = {
  id: number
  值班日期: string
  班次: string
  status: string
  发布时间: string
  确认时间: string
  assignments: AssignmentView[]
  gaps: string[]
  people: string[]
  crossDay: boolean
  chained: boolean
  startTs: number
  endTs: number
}

export type ShiftInput = {
  值班日期: string
  班次: string
  people: Record<string, string>
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

export function nowStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 白班 08:00-20:00 当天结束；夜班 20:00 到次日 08:00，跨天。
export function shiftSpan(date: string, shift: string): { startTs: number; endTs: number; crossDay: boolean } {
  const base = new Date(`${date}T00:00:00`).getTime()
  const startHour = shift === '夜班' ? 20 : 8
  const endHour = shift === '夜班' ? 32 : 20
  return {
    startTs: base + startHour * 3600_000,
    endTs: base + endHour * 3600_000,
    crossDay: endHour > 24,
  }
}

function findShift(shiftId: number): EntryRow | undefined {
  return listRows(SHIFT_KEY).find((row) => Number(row.id) === shiftId)
}

// 当前在岗 = 同一岗位下生效时间最晚的那条；换班只追加新记录，原记录不动。
export function currentAssignments(shiftId: number): AssignmentView[] {
  const rows = listRows(ASSIGN_KEY).filter((row) => Number(row.班次ID) === shiftId)
  const byPost = new Map<string, EntryRow>()
  for (const row of rows) {
    const post = String(row.岗位)
    const held = byPost.get(post)
    if (!held || String(row.生效时间) > String(held.生效时间)
      || (String(row.生效时间) === String(held.生效时间) && Number(row.id) > Number(held.id))) {
      byPost.set(post, row)
    }
  }
  return ALL_POSTS.filter((post) => byPost.has(post)).map((post) => {
    const row = byPost.get(post) as EntryRow
    return {
      id: Number(row.id),
      岗位: post,
      值班人: String(row.值班人),
      来源: String(row.来源),
      生效时间: String(row.生效时间),
    }
  })
}

function missingPosts(assignments: AssignmentView[]): string[] {
  const filled = new Set(assignments.map((item) => item.岗位))
  return ALL_POSTS.filter((post) => !filled.has(post))
}

// 同一个人在同一个班次里只能出现一次：带班人不能再占岗位，岗位之间也不能重复。
function duplicatePerson(people: string[]): string | null {
  const seen = new Set<string>()
  for (const person of people) {
    if (seen.has(person)) {
      return person
    }
    seen.add(person)
  }
  return null
}

// 发布之后只有值班长能改，其余人的改动一律退回。
function guardPublished(shift: EntryRow, role: string): ActionResult | null {
  if (String(shift.status) !== '草稿' && role !== CHIEF_ROLE) {
    return { ok: false, message: `排班已${String(shift.status)}，仅值班长可改动，本次改动已退回` }
  }
  return null
}

// 班次行上的带班人/值守岗位/岗位缺口只是展示缓存，一切以人员流水为准，每次变动后重算。
function refreshShiftSummary(shiftId: number): void {
  const shifts = listRows(SHIFT_KEY)
  const index = shifts.findIndex((row) => Number(row.id) === shiftId)
  if (index < 0) {
    return
  }
  const assignments = currentAssignments(shiftId)
  const leader = assignments.find((item) => item.岗位 === LEADER_POST)
  const posts = REQUIRED_POSTS
    .map((post) => {
      const hit = assignments.find((item) => item.岗位 === post)
      return hit ? `${post}:${hit.值班人}` : ''
    })
    .filter((text) => text !== '')
  const gaps = missingPosts(assignments)
  const next = [...shifts]
  next[index] = {
    ...shifts[index],
    带班人: leader ? leader.值班人 : '',
    值守岗位: posts.join('；'),
    岗位缺口: gaps.length ? gaps.join('、') : '无',
  }
  saveRows(SHIFT_KEY, next)
}

export function listShifts(): ShiftView[] {
  const views = listRows(SHIFT_KEY).map((row) => {
    const id = Number(row.id)
    const span = shiftSpan(String(row.值班日期), String(row.班次))
    const assignments = currentAssignments(id)
    return {
      id,
      值班日期: String(row.值班日期),
      班次: String(row.班次),
      status: String(row.status),
      发布时间: String(row.发布时间 ?? ''),
      确认时间: String(row.确认时间 ?? ''),
      assignments,
      gaps: missingPosts(assignments),
      people: assignments.map((item) => item.值班人),
      crossDay: span.crossDay,
      chained: false,
      startTs: span.startTs,
      endTs: span.endTs,
    }
  })
  views.sort((a, b) => a.startTs - b.startTs || a.id - b.id)
  // 上一个班次的结束时刻正好接上本班次的开始时刻，就是跨天连续班，页面上要高亮。
  for (let index = 1; index < views.length; index += 1) {
    views[index].chained = views[index - 1].endTs === views[index].startTs
  }
  return views
}

export function createShift(input: ShiftInput): ActionResult {
  const date = input.值班日期.trim()
  const name = input.班次.trim()
  if (!date || !name) {
    return { ok: false, message: '值班日期和班次都要填' }
  }
  const shifts = listRows(SHIFT_KEY)
  if (shifts.some((row) => String(row.值班日期) === date && String(row.班次) === name)) {
    return { ok: false, message: `${date} 的${name}已经排过，同一日期同一班次只留一条` }
  }
  const people = ALL_POSTS.map((post) => (input.people[post] ?? '').trim()).filter((person) => person !== '')
  const dup = duplicatePerson(people)
  if (dup) {
    return { ok: false, message: `${dup} 在同一个班次里只能出现一次` }
  }
  const shiftId = nextId(shifts)
  saveRows(SHIFT_KEY, [
    ...shifts,
    {
      id: shiftId,
      status: '草稿',
      pending: true,
      abnormal: false,
      值班日期: date,
      班次: name,
      带班人: '',
      值守岗位: '',
      岗位缺口: '无',
      发布时间: '',
      确认时间: '',
    },
  ])
  const assigns = listRows(ASSIGN_KEY)
  let assignId = nextId(assigns)
  const added = ALL_POSTS.filter((post) => (input.people[post] ?? '').trim() !== '').map((post) => ({
    id: assignId++,
    status: '在岗',
    pending: true,
    abnormal: false,
    班次ID: shiftId,
    值班日期: date,
    班次: name,
    岗位: post,
    值班人: (input.people[post] ?? '').trim(),
    来源: '排班',
    生效时间: '',
  }))
  saveRows(ASSIGN_KEY, [...assigns, ...added])
  refreshShiftSummary(shiftId)
  return { ok: true, message: `${date} ${name}已建好，岗位齐了之后才能发布` }
}

export function updateShift(shiftId: number, input: ShiftInput, role: string): ActionResult {
  const shift = findShift(shiftId)
  if (!shift) {
    return { ok: false, message: '没有找到这个班次' }
  }
  const rejected = guardPublished(shift, role)
  if (rejected) {
    return rejected
  }
  if (String(shift.status) === '已确认') {
    return { ok: false, message: '排班已确认，人员变动请走换班流程，换班会留痕' }
  }
  const people = ALL_POSTS.map((post) => (input.people[post] ?? '').trim()).filter((name) => name !== '')
  const dup = duplicatePerson(people)
  if (dup) {
    return { ok: false, message: `${dup} 在同一个班次里只能出现一次` }
  }
  // 换班产生的人员记录不动，只重建「排班」来源的部分。
  const kept = listRows(ASSIGN_KEY).filter(
    (row) => !(Number(row.班次ID) === shiftId && String(row.来源) === '排班'),
  )
  let assignId = nextId(listRows(ASSIGN_KEY))
  const effective = String(shift.status) === '已发布' ? String(shift.发布时间) : ''
  const added = ALL_POSTS.filter((post) => (input.people[post] ?? '').trim() !== '').map((post) => ({
    id: assignId++,
    status: '在岗',
    pending: true,
    abnormal: false,
    班次ID: shiftId,
    值班日期: String(shift.值班日期),
    班次: String(shift.班次),
    岗位: post,
    值班人: (input.people[post] ?? '').trim(),
    来源: '排班',
    生效时间: effective,
  }))
  saveRows(ASSIGN_KEY, [...kept, ...added])
  refreshShiftSummary(shiftId)
  return { ok: true, message: '班次人员已更新' }
}

export function publishShift(shiftId: number, role: string): ActionResult {
  const shifts = listRows(SHIFT_KEY)
  const index = shifts.findIndex((row) => Number(row.id) === shiftId)
  if (index < 0) {
    return { ok: false, message: '没有找到这个班次' }
  }
  const shift = shifts[index]
  const rejected = guardPublished(shift, role)
  if (rejected) {
    return rejected
  }
  if (String(shift.status) !== '草稿') {
    return { ok: false, message: `排班已经是「${String(shift.status)}」，不用重复发布` }
  }
  const assignments = currentAssignments(shiftId)
  const gaps = missingPosts(assignments)
  if (gaps.length) {
    return { ok: false, message: `班次还缺岗位（${gaps.join('、')}），缺岗位的班次不允许发布` }
  }
  const dup = duplicatePerson(assignments.map((item) => item.值班人))
  if (dup) {
    return { ok: false, message: `${dup} 在同一个班次里只能出现一次` }
  }
  const stamp = nowStamp()
  const next = [...shifts]
  next[index] = { ...shift, status: '已发布', pending: true, 发布时间: stamp }
  saveRows(SHIFT_KEY, next)
  // 排班来源的人员从发布这一刻起生效。
  const assigns = listRows(ASSIGN_KEY).map((row) =>
    Number(row.班次ID) === shiftId && String(row.来源) === '排班' ? { ...row, 生效时间: stamp } : row,
  )
  saveRows(ASSIGN_KEY, assigns)
  refreshShiftSummary(shiftId)
  return { ok: true, message: `排班已发布，发布后仅${CHIEF_ROLE}可改动` }
}

export function revokeShift(shiftId: number, role: string): ActionResult {
  const shifts = listRows(SHIFT_KEY)
  const index = shifts.findIndex((row) => Number(row.id) === shiftId)
  if (index < 0) {
    return { ok: false, message: '没有找到这个班次' }
  }
  const shift = shifts[index]
  const rejected = guardPublished(shift, role)
  if (rejected) {
    return rejected
  }
  if (String(shift.status) !== '已发布') {
    return { ok: false, message: '只有已发布的排班才能撤回重排' }
  }
  const next = [...shifts]
  next[index] = { ...shift, status: '草稿', pending: true }
  saveRows(SHIFT_KEY, next)
  return { ok: true, message: '排班已撤回为草稿，可以重新编排' }
}

// 排班确认 = 结论定稿：回写交接班待办，同一个人在同一班次重复提交只留一条。
export function confirmShift(shiftId: number, role: string): ActionResult {
  const shifts = listRows(SHIFT_KEY)
  const index = shifts.findIndex((row) => Number(row.id) === shiftId)
  if (index < 0) {
    return { ok: false, message: '没有找到这个班次' }
  }
  const shift = shifts[index]
  const rejected = guardPublished(shift, role)
  if (rejected) {
    return rejected
  }
  if (String(shift.status) !== '已发布') {
    return { ok: false, message: '只有已发布的排班才能确认' }
  }
  const stamp = nowStamp()
  const next = [...shifts]
  next[index] = { ...shift, status: '已确认', pending: false, 确认时间: stamp }
  saveRows(SHIFT_KEY, next)
  const assignments = currentAssignments(shiftId)
  const todos = listRows(HANDOVER_KEY)
  let todoId = nextId(todos)
  const kept = todos.filter(
    (row) => !(Number(row.班次ID) === shiftId && assignments.some((item) => item.值班人 === String(row.值班人))),
  )
  const added = assignments.map((item) => ({
    id: todoId++,
    status: '待交接',
    pending: true,
    abnormal: false,
    班次ID: shiftId,
    值班日期: String(shift.值班日期),
    班次: String(shift.班次),
    值班人: item.值班人,
    岗位: item.岗位,
    交接事项: `${String(shift.值班日期)} ${String(shift.班次)}「${item.岗位}」由${item.值班人}值守，排班已确认，待交接`,
    来源: '排班确认',
    生成时间: stamp,
    交接时间: '',
  }))
  saveRows(HANDOVER_KEY, [...kept, ...added])
  return { ok: true, message: `排班已确认，${added.length} 条交接事项已带到交接班待办` }
}

export function requestSwap(shiftId: number, post: string, toPerson: string, role: string): ActionResult {
  const shift = findShift(shiftId)
  if (!shift) {
    return { ok: false, message: '没有找到这个班次' }
  }
  if (String(shift.status) === '草稿') {
    return { ok: false, message: '草稿直接改人就行，排班发布后才走换班留痕' }
  }
  const rejected = guardPublished(shift, role)
  if (rejected) {
    return rejected
  }
  const target = toPerson.trim()
  if (!ALL_POSTS.includes(post)) {
    return { ok: false, message: `没有「${post}」这个岗位` }
  }
  if (!target) {
    return { ok: false, message: '接班人要填' }
  }
  const assignments = currentAssignments(shiftId)
  const holder = assignments.find((item) => item.岗位 === post)
  if (!holder) {
    return { ok: false, message: `「${post}」还没排人，先补齐岗位再谈换班` }
  }
  if (holder.值班人 === target) {
    return { ok: false, message: '接班人就是现在的值班人，不用换' }
  }
  if (assignments.some((item) => item.值班人 === target)) {
    return { ok: false, message: `${target} 已在这个班次里，同一班次一个人只能出现一次` }
  }
  const swaps = listRows(SWAP_KEY)
  if (swaps.some((row) => Number(row.班次ID) === shiftId && String(row.岗位) === post && String(row.status) === '待确认')) {
    return { ok: false, message: `「${post}」已有一笔待确认的换班，先处理完` }
  }
  saveRows(SWAP_KEY, [
    ...swaps,
    {
      id: nextId(swaps),
      status: '待确认',
      pending: true,
      abnormal: false,
      班次ID: shiftId,
      值班日期: String(shift.值班日期),
      班次: String(shift.班次),
      岗位: post,
      让班人: holder.值班人,
      接班人: target,
      申请时间: nowStamp(),
      确认时间: '',
    },
  ])
  return { ok: true, message: `换班申请已登记：${holder.值班人} 把「${post}」让给 ${target}，待确认` }
}

export function confirmSwap(swapId: number, role: string): ActionResult {
  const swaps = listRows(SWAP_KEY)
  const index = swaps.findIndex((row) => Number(row.id) === swapId)
  if (index < 0) {
    return { ok: false, message: '没有找到这笔换班' }
  }
  const swap = swaps[index]
  if (String(swap.status) !== '待确认') {
    return { ok: false, message: `这笔换班已经是「${String(swap.status)}」，不用重复确认` }
  }
  const shift = findShift(Number(swap.班次ID))
  if (!shift) {
    return { ok: false, message: '换班对应的班次不存在' }
  }
  const rejected = guardPublished(shift, role)
  if (rejected) {
    return rejected
  }
  const post = String(swap.岗位)
  const assignments = currentAssignments(Number(swap.班次ID))
  const holder = assignments.find((item) => item.岗位 === post)
  if (!holder || holder.值班人 !== String(swap.让班人)) {
    return { ok: false, message: '原值班人已经变动，这笔换班作废，请重新发起' }
  }
  const target = String(swap.接班人)
  if (assignments.some((item) => item.值班人 === target)) {
    return { ok: false, message: `${target} 已在这个班次里，同一班次一个人只能出现一次` }
  }
  const stamp = nowStamp()
  // 留痕：原来那个人的记录不动，新的人追加一条，从确认这一刻起算。
  const assigns = listRows(ASSIGN_KEY)
  saveRows(ASSIGN_KEY, [
    ...assigns,
    {
      id: nextId(assigns),
      status: '在岗',
      pending: true,
      abnormal: false,
      班次ID: Number(swap.班次ID),
      值班日期: String(swap.值班日期),
      班次: String(swap.班次),
      岗位: post,
      值班人: target,
      来源: '换班',
      生效时间: stamp,
    },
  ])
  const next = [...swaps]
  next[index] = { ...swap, status: '已确认', pending: false, 确认时间: stamp }
  saveRows(SWAP_KEY, next)
  refreshShiftSummary(Number(swap.班次ID))
  // 班次已确认过的，交接待办同步换人：让班人的待交接撤下，接班人补一条（同人同班只留一条）。
  if (String(shift.status) === '已确认') {
    const todos = listRows(HANDOVER_KEY)
    const kept = todos.filter(
      (row) => !(Number(row.班次ID) === Number(swap.班次ID)
        && ((String(row.值班人) === String(swap.让班人) && String(row.岗位) === post && String(row.status) === '待交接')
          || String(row.值班人) === target)),
    )
    saveRows(HANDOVER_KEY, [
      ...kept,
      {
        id: nextId(todos),
        status: '待交接',
        pending: true,
        abnormal: false,
        班次ID: Number(swap.班次ID),
        值班日期: String(swap.值班日期),
        班次: String(swap.班次),
        值班人: target,
        岗位: post,
        交接事项: `${String(swap.值班日期)} ${String(swap.班次)}「${post}」由${target}值守，排班已确认，待交接`,
        来源: '排班确认',
        生成时间: stamp,
        交接时间: '',
      },
    ])
  }
  return { ok: true, message: `换班已确认：${String(swap.让班人)} → ${target}（${post}），${stamp} 起算` }
}

export function rejectSwap(swapId: number, role: string): ActionResult {
  const swaps = listRows(SWAP_KEY)
  const index = swaps.findIndex((row) => Number(row.id) === swapId)
  if (index < 0) {
    return { ok: false, message: '没有找到这笔换班' }
  }
  const swap = swaps[index]
  if (String(swap.status) !== '待确认') {
    return { ok: false, message: `这笔换班已经是「${String(swap.status)}」` }
  }
  const shift = findShift(Number(swap.班次ID))
  if (shift) {
    const rejected = guardPublished(shift, role)
    if (rejected) {
      return rejected
    }
  }
  const next = [...swaps]
  next[index] = { ...swap, status: '已退回', pending: false, abnormal: true }
  saveRows(SWAP_KEY, next)
  return { ok: true, message: '换班已退回，班次人员不变' }
}

export function listSwaps(): EntryRow[] {
  return [...listRows(SWAP_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
}

export function listHandover(): EntryRow[] {
  return [...listRows(HANDOVER_KEY)].sort(
    (a, b) =>
      String(a.值班日期).localeCompare(String(b.值班日期))
      || String(a.班次).localeCompare(String(b.班次))
      || Number(a.id) - Number(b.id),
  )
}

export function completeHandover(todoId: number): ActionResult {
  const todos = listRows(HANDOVER_KEY)
  const index = todos.findIndex((row) => Number(row.id) === todoId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条交接事项' }
  }
  if (String(todos[index].status) === '已交接') {
    return { ok: false, message: '这条事项已经交接过了' }
  }
  const next = [...todos]
  next[index] = { ...todos[index], status: '已交接', pending: false, 交接时间: nowStamp() }
  saveRows(HANDOVER_KEY, next)
  return { ok: true, message: '交接完成，事项已归档' }
}
