<template>
  <section class="page sched-page">
    <header class="page-head">
      <div>
        <h2>汛期值班排班</h2>
        <p class="page-desc">
          按值班日期和班次编排，每个班次指定带班人与值守岗位；缺岗位的班次不允许发布，换班全程留痕。
        </p>
      </div>
      <div class="page-actions">
        <label class="identity-box">
          <span>当前身份</span>
          <select :value="store.role" @change="onRoleChange">
            <option value="值班长">值班长</option>
            <option value="值班员">值班员（只读）</option>
          </select>
        </label>
        <button class="btn" type="button" @click="resetData">重置示例</button>
      </div>
    </header>

    <div v-if="!chief" class="readonly-banner">
      只读视图：你当前是「值班员」，排班已发布后的任何改动都会被退回。需要换班可在岗位上提交申请，由值班长确认。
    </div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <template v-if="activeTab === 'grid'">
      <div class="toolbar">
        <label class="identity-box">
          <span>排班单</span>
          <select :value="currentId" @change="onSheetChange">
            <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
              {{ sheet.name }}（{{ sheet.status }}）
            </option>
          </select>
        </label>
        <template v-if="current">
          <span class="status-pill" :class="statusClass(current.status)">{{ current.status }}</span>
          <span class="muted">编排 {{ current.createdAt }}<template v-if="current.publishedAt"> · 发布 {{ current.publishedAt }}</template><template v-if="current.confirmedAt"> · 确认 {{ current.confirmedAt }}</template></span>
          <span class="toolbar-spacer"></span>
          <button v-if="chief && current.status === '草稿'" class="btn primary" type="button" @click="openCreateSlot">批量编排</button>
          <button v-if="chief && current.status === '草稿'" class="btn" type="button" @click="publish">发布排班</button>
          <button v-if="chief && current.status === '已发布'" class="btn primary" type="button" @click="confirm">排班确认</button>
          <button class="btn ghost" type="button" @click="activeTab = 'swaps'">
            换班记录<template v-if="pendingSwapCount">（{{ pendingSwapCount }} 待确认）</template>
          </button>
        </template>
        <span class="toolbar-spacer"></span>
        <button v-if="chief" class="btn primary" type="button" @click="openNewSheet">新建排班</button>
      </div>

      <div v-if="current" class="stat-row">
        <article class="stat-card">
          <span class="stat-label">班次总数</span>
          <strong class="stat-value">{{ current.shifts.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">缺岗位班次</span>
          <strong class="stat-value" :class="{ warn: issueCount > 0 }">{{ issueCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">跨天夜班</span>
          <strong class="stat-value">{{ crossDayCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">跨天连班</span>
          <strong class="stat-value" :class="{ warn: backToBackCount > 0 }">{{ backToBackCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已带出交接待办</span>
          <strong class="stat-value">{{ handoverCount }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span class="legend-item">🌙 跨天夜班（20:00–次日08:00）</span>
        <span class="legend-item cont">🟧 跨天连续班次：同一人紧接相邻班次</span>
        <span class="legend-item miss">⚠ 岗位空缺 / 同班重复</span>
      </p>

      <table class="data-table sched-grid">
        <thead>
          <tr>
            <th class="col-date">值班日期</th>
            <th class="col-shift">班次</th>
            <th>带班人</th>
            <th v-for="post in posts" :key="post">{{ post }}</th>
            <th>校验</th>
            <th v-if="chief || (current && current.status !== '草稿')">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="cell in gridByDate" :key="cell.date">
            <tr v-for="(shift, idx) in cell.shifts" :key="shift.id" :class="{ cross: isCrossDay(shift) }">
              <td v-if="idx === 0" :rowspan="cell.shifts.length" class="col-date">
                <strong>{{ cell.date }}</strong>
                <span class="weekday">{{ weekday(cell.date) }}</span>
              </td>
              <td class="col-shift">
                {{ shift.shift }}
                <small>{{ shiftTime(shift) }}</small>
                <span v-if="isCrossDay(shift)" class="tag cross-tag">跨天</span>
              </td>
              <td :class="cellClass(shift, '__leader__')">
                <PersonCell
                  :name="shift.leader"
                  :back-to-back="!!continuity.get(shift.id)?.backToBackWith"
                  :effective="leaderEffective(shift)"
                />
              </td>
              <td v-for="slot in shift.posts" :key="slot.id" :class="cellClass(shift, slot.id)">
                <PersonCell
                  :name="slot.assignee"
                  :back-to-back="!!continuity.get(shift.id)?.backToBackWith"
                  :effective="slot.effectiveSince"
                />
              </td>
              <td>
                <span v-if="issueOf(shift).length === 0" class="ok-text">齐全</span>
                <ul v-else class="issue-list">
                  <li v-for="text in issueOf(shift)" :key="text">{{ text }}</li>
                </ul>
              </td>
              <td v-if="chief || (current && current.status !== '草稿')" class="row-actions">
                <button
                  v-if="chief"
                  class="link"
                  type="button"
                  @click="openEdit(shift, '__leader__')"
                >派带班</button>
                <template v-for="slot in shift.posts" :key="`a${slot.id}`">
                  <button v-if="chief" class="link" type="button" @click="openEdit(shift, slot.id)">
                    派{{ slot.post }}
                  </button>
                </template>
                <button
                  v-if="current && current.status !== '草稿' && shift.leader"
                  class="link warn-link"
                  type="button"
                  @click="openSwap(shift, '__leader__')"
                >带班让班</button>
                <template v-for="slot in shift.posts" :key="`s${slot.id}`">
                  <button
                    v-if="current && current.status !== '草稿' && slot.assignee"
                    class="link warn-link"
                    type="button"
                    @click="openSwap(shift, slot.id)"
                  >{{ slot.post }}让班</button>
                </template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <section v-if="current" class="history-panel">
        <h3>班次编排/换班轨迹（原记录不删不改，只追加）</h3>
        <div v-for="shift in historyShifts" :key="shift.id" class="history-block">
          <h4>{{ shift.date }} {{ shift.shift }}</h4>
          <ol v-if="shift.history.length">
            <li v-for="(entry, i) in shift.history" :key="i">
              <span class="hist-time">{{ entry.at }}</span>
              <span class="hist-action" :class="entry.action">{{ entry.action }}</span>
              <span class="hist-text">
                <template v-if="entry.fromPerson && entry.toPerson">{{ entry.fromPerson }} → {{ entry.toPerson }}</template>
                <template v-else-if="entry.toPerson">安排 {{ entry.toPerson }}</template>
                <template v-else>清空（{{ entry.fromPerson }}）</template>
                · {{ entry.operator }}
              </span>
            </li>
          </ol>
          <p v-else class="muted">暂无记录</p>
        </div>
      </section>
    </template>

    <template v-else-if="activeTab === 'swaps'">
    <section v-if="current" class="swap-panel">
      <header class="sub-head">
        <h3>{{ current.name }} · 换班留痕</h3>
        <p class="muted">谁把班让给谁、什么时候由谁确认，全部记录在案；确认后原值班人的历史记录不动，新人从确认时刻起算。</p>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>申请时间</th><th>班次</th><th>岗位</th><th>让班人</th><th>接班人</th>
            <th>事由</th><th>状态</th><th>确认人/时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="swap in swaps" :key="swap.id">
            <td>{{ swap.requestedAt }}</td>
            <td>{{ swap.date }} {{ swap.shift }}</td>
            <td>{{ swap.post }}</td>
            <td>{{ swap.fromPerson }}<small class="muted">（{{ swap.requestedBy }}发起）</small></td>
            <td><strong>{{ swap.toPerson }}</strong></td>
            <td>{{ swap.reason || '—' }}</td>
            <td>
              <span class="status-pill" :class="swapClass(swap.status)">{{ swap.status }}</span>
              <div v-if="swap.rejectNote" class="muted">退回说明：{{ swap.rejectNote }}</div>
            </td>
            <td>
              <template v-if="swap.confirmedAt">{{ swap.confirmedBy }} · {{ swap.confirmedAt }}</template>
              <span v-else class="muted">待值班长确认</span>
            </td>
            <td class="row-actions">
              <button
                v-if="chief && swap.status === '待确认'"
                class="link"
                type="button"
                @click="doConfirmSwap(swap.id)"
              >确认换班</button>
              <button
                v-if="chief && swap.status === '待确认'"
                class="link warn-link"
                type="button"
                @click="doRejectSwap(swap.id)"
              >退回</button>
              <span v-else-if="swap.status !== '待确认'" class="muted">已闭环</span>
            </td>
          </tr>
          <tr v-if="!swaps.length">
            <td colspan="9" class="empty-state">还没有换班记录</td>
          </tr>
        </tbody>
      </table>
      <p class="page-foot">
        <RouterLink class="link" to="/handover">前往交接班待办 →</RouterLink>
      </p>
    </section>
    </template>

    <!-- 新建排班单 -->
    <div v-if="showNewSheet" class="modal-mask" @click.self="showNewSheet = false">
      <form class="modal" @submit.prevent="createSheet">
        <h3>新建汛期值班排班</h3>
        <label class="form-row"><span>排班名称</span><input v-model="newSheet.name" placeholder="如：2026年10月下旬汛期值班表" /></label>
        <label class="form-row"><span>开始日期</span><input v-model="newSheet.startDate" type="date" /></label>
        <label class="form-row"><span>结束日期</span><input v-model="newSheet.endDate" type="date" /></label>
        <p class="muted">每天自动生成白班（08:00–20:00）与夜班（20:00–次日08:00）两个班次。</p>
        <p v-if="message" class="error-text">{{ message }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="showNewSheet = false">取消</button>
          <button class="btn primary" type="submit">生成空白排班</button>
        </div>
      </form>
    </div>

    <!-- 派人 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <form class="modal" @submit.prevent="saveAssign">
        <h3>{{ editing.shift.date }} {{ editing.shift.shift }} · {{ editing.slotId === '__leader__' ? '带班人' : editingSlot?.post }}</h3>
        <p class="muted">
          班次时间：{{ editing.shift.startAt }} – {{ editing.shift.endAt }}
          <template v-if="editing.shift.endAt.slice(0, 10) !== editing.shift.date">（夜班跨天）</template>
        </p>
        <label class="form-row">
          <span>值班人员</span>
          <select v-model="assignName">
            <option value="">— 清空（仅草稿） —</option>
            <option v-for="name in people" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <p v-if="message" class="error-text">{{ message }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="editing = null">取消</button>
          <button class="btn primary" type="submit">提交排班</button>
        </div>
      </form>
    </div>

    <!-- 换班申请 -->
    <div v-if="swapping" class="modal-mask" @click.self="swapping = null">
      <form class="modal" @submit.prevent="saveSwap">
        <h3>申请换班 · {{ swapping.shift.date }} {{ swapping.shift.shift }}</h3>
        <p class="muted">
          岗位：{{ swapping.slotId === '__leader__' ? '带班人' : swappingSlot?.post }} ·
          当前值班人：<strong>{{ swapFrom }}</strong>
        </p>
        <label class="form-row">
          <span>让班给</span>
          <select v-model="swapTo">
            <option value="">— 选择接班人 —</option>
            <option v-for="name in swapCandidates" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="form-row"><span>让班事由</span><textarea v-model="swapReason" rows="3" /></label>
        <p class="muted">提交后需值班长确认；确认时刻即新人起算时刻，原值班人记录原样保留。</p>
        <p v-if="message" class="error-text">{{ message }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="swapping = null">取消</button>
          <button class="btn primary" type="submit">提交换班申请</button>
        </div>
      </form>
    </div>

    <p v-if="message" class="float-msg" :class="{ ok: messageOk }">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { scheduleState } from '@/data/schedule-store'
import type { ShiftSlot } from '@/data/schedule-types'
import {
  assignPerson,
  confirmSheet,
  confirmSwap,
  continuityMap,
  createSheet as createSheetApi,
  duplicatePeopleOf,
  listHandovers,
  listPeople,
  listPosts,
  listSheets,
  listSwaps,
  missingPostsOf,
  publishSheet,
  rejectSwap,
  requestSwap,
  resetScheduleData,
  type Actor,
} from '@/api/schedule-service'

// 单元格里的人名：带跨天连班高亮与起算时刻提示。
const PersonCell = (props: { name: string; backToBack: boolean; effective: string }) =>
  h(
    'span',
    {
      class: ['person-cell', { 'back-to-back': props.backToBack, empty: !props.name }],
      title: props.effective ? `自 ${props.effective} 起当班` : '尚未编排',
    },
    [
      props.name
        ? h('span', { class: 'person-name' }, [props.backToBack ? '🟧 ' : '', props.name])
        : h('span', { class: 'muted' }, '空缺'),
      props.effective ? h('small', { class: 'muted eff' }, props.effective.slice(5, 16)) : null,
    ],
  )
PersonCell.props = ['name', 'backToBack', 'effective']

const store = useSessionStore()
const route = useRoute()
const chief = computed(() => store.isChief)

const tabs = [
  { key: 'grid', label: '排班表' },
  { key: 'swaps', label: '换班留痕' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('grid')

const sheets = ref(listSheets())
const currentId = ref(sheets.value[0]?.id ?? 0)
const current = computed(() => sheets.value.find((item) => item.id === currentId.value) ?? null)
const people = listPeople()
const posts = listPosts()

const message = ref('')
const messageOk = ref(false)
let messageTimer: ReturnType<typeof setTimeout> | undefined

function flash(text: string, ok = false) {
  message.value = text
  messageOk.value = ok
  if (messageTimer) {
    clearTimeout(messageTimer)
  }
  messageTimer = setTimeout(() => {
    message.value = ''
  }, 3600)
}

function actor(): Actor {
  return { name: store.operator, role: store.role }
}

function reload() {
  sheets.value = listSheets(scheduleState())
  if (!sheets.value.some((item) => item.id === currentId.value)) {
    currentId.value = sheets.value[0]?.id ?? 0
  }
}

function onRoleChange(event: Event) {
  const role = (event.target as HTMLSelectElement).value as '值班长' | '值班员'
  const name = role === '值班长' ? '张建国' : people[1] ?? '值班员'
  store.setIdentity(name, role)
}

function onSheetChange(event: Event) {
  currentId.value = Number((event.target as HTMLSelectElement).value)
}

const swaps = computed(() => (current.value ? listSwaps(current.value.id) : []))
const pendingSwapCount = computed(() => swaps.value.filter((item) => item.status === '待确认').length)
const handoverCount = computed(() =>
  current.value ? listHandovers(current.value.id).length : 0,
)

const continuity = computed(() =>
  current.value ? continuityMap(current.value) : new Map<string, { crossDay: boolean; backToBackWith: ShiftSlot | null }>(),
)

const gridByDate = computed(() => {
  const map = new Map<string, ShiftSlot[]>()
  if (current.value) {
    const sorted = [...current.value.shifts].sort((a, b) => {
      if (a.date !== b.date) {
        return a.date < b.date ? -1 : 1
      }
      return a.startAt < b.startAt ? -1 : 1
    })
    for (const shift of sorted) {
      const list = map.get(shift.date) ?? []
      list.push(shift)
      map.set(shift.date, list)
    }
  }
  return [...map.entries()].map(([date, shifts]) => ({ date, shifts }))
})

const issueCount = computed(() =>
  current.value
    ? current.value.shifts.filter((s) => issueTexts(s).length > 0).length
    : 0,
)

const crossDayCount = computed(() => {
  let n = 0
  continuity.value.forEach((item) => {
    if (item.crossDay) {
      n += 1
    }
  })
  return n
})

const backToBackCount = computed(() => {
  let n = 0
  continuity.value.forEach((item) => {
    if (item.backToBackWith) {
      n += 1
    }
  })
  return n
})

const historyShifts = computed(() =>
  current.value
    ? [...current.value.shifts]
        .filter((s) => s.history.length > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.shift < b.shift ? -1 : 1))
    : [],
)

function isCrossDay(shift: ShiftSlot): boolean {
  return shift.endAt.slice(0, 10) !== shift.date
}

function shiftTime(shift: ShiftSlot): string {
  return `${shift.startAt.slice(11)}–${shift.endAt.slice(11)}`
}

function weekday(date: string): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[new Date(`${date}T00:00:00`).getDay()]
}

function issueTexts(shift: ShiftSlot): string[] {
  const texts: string[] = []
  for (const name of missingPostsOf(shift)) {
    texts.push(`缺${name}`)
  }
  for (const name of duplicatePeopleOf(shift)) {
    texts.push(`${name}同班重复`)
  }
  return texts
}

function issueOf(shift: ShiftSlot): string[] {
  return issueTexts(shift)
}

function cellClass(shift: ShiftSlot, slotId: string): Record<string, boolean> {
  const slot = slotId === '__leader__' ? null : shift.posts.find((item) => item.id === slotId)
  const name = slotId === '__leader__' ? shift.leader : slot?.assignee ?? ''
  const duplicates = duplicatePeopleOf(shift)
  return {
    'cell-miss': !name,
    'cell-dup': !!name && duplicates.includes(name),
    'cell-cont': !!continuity.value.get(shift.id)?.backToBackWith,
  }
}

function leaderEffective(shift: ShiftSlot): string {
  // 带班人没有单独的 effectiveSince 字段，用发布/确认/换班时间近似展示轨迹最后时间。
  const last = [...shift.history].reverse().find((item) => item.toPerson === shift.leader)
  return last?.at ?? (current.value?.publishedAt ?? '')
}

function statusClass(status: string): string {
  if (status === '已发布') {
    return 'st-published'
  }
  if (status === '已确认') {
    return 'st-confirmed'
  }
  return 'st-draft'
}

function swapClass(status: string): string {
  if (status === '已确认') {
    return 'st-confirmed'
  }
  if (status === '已退回') {
    return 'st-rejected'
  }
  return 'st-pending'
}

// ---------- 新建排班 ----------

const showNewSheet = ref(false)
const newSheet = ref({ name: '', startDate: '2026-10-15', endDate: '2026-10-16' })

function openNewSheet() {
  newSheet.value = { name: '', startDate: '2026-10-15', endDate: '2026-10-16' }
  message.value = ''
  showNewSheet.value = true
}

function createSheet() {
  const result = createSheetApi({ ...newSheet.value }, actor())
  if (!result.ok) {
    flash(result.message)
    return
  }
  showNewSheet.value = false
  reload()
  if (result.data) {
    currentId.value = result.data
  }
  flash(result.message, true)
}

// ---------- 派人 ----------

const editing = ref<{ shift: ShiftSlot; slotId: string } | null>(null)
const assignName = ref('')

const editingSlot = computed(() => {
  if (!editing.value) {
    return null
  }
  return editing.value.shift.posts.find((item) => item.id === editing.value!.slotId) ?? null
})

function openEdit(shift: ShiftSlot, slotId: string) {
  if (!chief.value) {
    flash('只读视图：排班发布后仅值班长可派人，改动已退回')
    return
  }
  editing.value = { shift, slotId }
  assignName.value = slotId === '__leader__' ? shift.leader : shift.posts.find((i) => i.id === slotId)?.assignee ?? ''
  message.value = ''
}

function openCreateSlot() {
  // 批量编排：直接定位第一个空缺，点完自动跳下一个空缺。
  const first = current.value?.shifts.find((s) => missingPostsOf(s).length > 0)
  if (!first) {
    flash('所有班次都已排满，可以直接发布', true)
    return
  }
  let slotId = '__leader__'
  if (first.leader) {
    slotId = first.posts.find((p) => !p.assignee)?.id ?? '__leader__'
  }
  openEdit(first, slotId)
}

function saveAssign() {
  if (!editing.value || !current.value) {
    return
  }
  const { shift, slotId } = editing.value
  const result = assignPerson(current.value.id, shift.id, slotId, assignName.value, actor())
  if (!result.ok) {
    flash(result.message)
    return
  }
  editing.value = null
  reload()
  flash(result.message, true)
  // 批量编排：派人成功后自动定位下一个空缺，排满就提示可以发布。
  if (assignName.value) {
    jumpToNextGap()
  }
}

function jumpToNextGap() {
  const sheet = sheets.value.find((item) => item.id === currentId.value)
  if (!sheet) {
    return
  }
  for (const nextShift of sheet.shifts) {
    if (!nextShift.leader) {
      editing.value = { shift: nextShift, slotId: '__leader__' }
      assignName.value = ''
      return
    }
    const emptyPost = nextShift.posts.find((post) => !post.assignee)
    if (emptyPost) {
      editing.value = { shift: nextShift, slotId: emptyPost.id }
      assignName.value = ''
      return
    }
  }
  if (sheet.status === '草稿') {
    flash('所有班次都已排满，可以发布了', true)
  }
}

// ---------- 换班 ----------

const swapping = ref<{ shift: ShiftSlot; slotId: string } | null>(null)
const swapTo = ref('')
const swapReason = ref('')

const swappingSlot = computed(() => {
  if (!swapping.value) {
    return null
  }
  return swapping.value.shift.posts.find((item) => item.id === swapping.value!.slotId) ?? null
})

const swapFrom = computed(() => {
  if (!swapping.value) {
    return ''
  }
  return swapping.value.slotId === '__leader__'
    ? swapping.value.shift.leader
    : swapping.value.shift.posts.find((i) => i.id === swapping.value!.slotId)?.assignee ?? ''
})

const swapCandidates = computed(() => {
  if (!swapping.value) {
    return []
  }
  const used = new Set([
    swapping.value.shift.leader,
    ...swapping.value.shift.posts.map((p) => p.assignee),
  ])
  return people.filter((name) => !used.has(name))
})

function openSwap(shift: ShiftSlot, slotId: string) {
  swapping.value = { shift, slotId }
  swapTo.value = ''
  swapReason.value = ''
  message.value = ''
}

function saveSwap() {
  if (!swapping.value || !current.value) {
    return
  }
  const result = requestSwap(
    current.value.id,
    swapping.value.shift.id,
    swapping.value.slotId,
    swapTo.value,
    swapReason.value,
    actor(),
  )
  if (!result.ok) {
    flash(result.message)
    return
  }
  swapping.value = null
  reload()
  flash(result.message, true)
}

function doConfirmSwap(id: number) {
  const result = confirmSwap(id, actor())
  reload()
  flash(result.message, result.ok)
}

function doRejectSwap(id: number) {
  const note = window.prompt('请填写退回说明（可留空）')
  if (note === null) {
    return
  }
  const result = rejectSwap(id, note, actor())
  reload()
  flash(result.message, result.ok)
}

// ---------- 发布 / 确认 ----------

function publish() {
  if (!current.value) {
    return
  }
  const result = publishSheet(current.value.id, actor())
  reload()
  flash(result.message, result.ok)
}

function confirm() {
  if (!current.value) {
    return
  }
  const result = confirmSheet(current.value.id, actor())
  reload()
  flash(result.message, result.ok)
}

function resetData() {
  const result = resetScheduleData()
  reload()
  flash(result.message, true)
}

onMounted(() => {
  reload()
  const querySheet = Number(route.query.sheet)
  if (querySheet && sheets.value.some((item) => item.id === querySheet)) {
    currentId.value = querySheet
  }
})
</script>

<style scoped>
.sched-page { display: flex; flex-direction: column; gap: 10px; }
.readonly-banner {
  background: #fff7ed; border: 1px solid #fdba74; color: #9a3412;
  border-radius: 8px; padding: 8px 12px; font-size: 13px;
}
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.toolbar-spacer { flex: 1; }
.identity-box { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.identity-box select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; }
.muted { color: var(--muted); font-size: 12px; }
.warn { color: #b42318 !important; }
.ok-text { color: #047857; font-size: 12px; }
.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border); }
.tab { border: none; background: none; padding: 8px 14px; cursor: pointer; font-size: 14px; color: var(--muted); border-bottom: 2px solid transparent; }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.st-draft { background: #eef2f7; color: #475569; }
.st-published, .st-pending { background: #fef3c7; color: #92400e; }
.st-confirmed { background: #dcfce7; color: #166534; }
.st-rejected { background: #fee2e2; color: #991b1b; }
.sched-grid { table-layout: auto; }
.col-date { min-width: 96px; }
.col-date .weekday { display: block; color: var(--muted); font-size: 12px; }
.col-shift { min-width: 130px; white-space: nowrap; }
.col-shift small { display: block; color: var(--muted); }
.cross-tag { background: #ede9fe; color: #6d28d9; border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
tr.cross { background: #faf5ff; }
.person-cell { display: inline-flex; flex-direction: column; gap: 2px; }
.person-cell.empty .person-name { color: var(--muted); }
.person-cell .eff { font-size: 10px; }
.person-cell.back-to-back .person-name { font-weight: 700; }
.cell-miss { background: #fef2f2; }
.cell-dup { background: #fee2e2 !important; }
.cell-cont { box-shadow: inset 3px 0 0 #f97316; }
.issue-list { margin: 0; padding-left: 16px; color: #b42318; font-size: 12px; }
.warn-link { color: #b45309; }
.history-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.history-panel h3 { margin: 0 0 8px; font-size: 14px; }
.history-block { margin-bottom: 8px; }
.history-block h4 { margin: 4px 0; font-size: 13px; }
.history-block ol { margin: 0; padding-left: 18px; }
.history-block li { font-size: 12px; margin: 2px 0; }
.hist-time { color: var(--muted); margin-right: 6px; }
.hist-action { border-radius: 4px; padding: 0 6px; margin-right: 6px; background: #eef2f7; }
.hist-action.换班确认 { background: #ffedd5; color: #9a3412; }
.hist-action.换班退回 { background: #fee2e2; color: #991b1b; }
.sub-head h3 { margin: 0 0 4px; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 420px; max-width: 92vw; }
.modal h3 { margin: 0 0 12px; font-size: 16px; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 13px; }
.form-row input, .form-row select, .form-row textarea { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.float-msg {
  position: fixed; right: 24px; bottom: 24px; z-index: 60;
  background: #b42318; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; max-width: 420px;
}
.float-msg.ok { background: #047857; }
.legend-item.cont { background: #ffedd5; }
.legend-item.miss { background: #fee2e2; }
</style>
