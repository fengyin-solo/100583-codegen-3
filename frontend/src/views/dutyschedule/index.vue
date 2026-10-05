<template>
  <section class="page" data-module="dutyschedule">
    <header class="page-head">
      <div>
        <h2>汛期值班排班</h2>
        <p class="page-desc">按值班日期和班次编排带班人与值守岗位；缺岗位的班次不允许发布，发布后仅值班长可改动，其余人只读。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">新建班次</button>
        <button class="btn" type="button" @click="exportRows">导出排班清单</button>
      </div>
    </header>

    <p v-if="readonly" class="readonly-banner">
      当前身份是「{{ store.role }}」：已发布、已确认的排班为只读视图，改动会被退回。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>值班日期</th>
          <th>班次</th>
          <th>连续班次</th>
          <th>带班人</th>
          <th v-for="post in posts" :key="post">{{ post }}</th>
          <th>岗位缺口</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="shift in shifts"
          :key="shift.id"
          :class="{ 'cross-day': shift.crossDay, chained: shift.chained }"
        >
          <td>{{ shift.值班日期 }}</td>
          <td>
            {{ shift.班次 }}
            <span v-if="shift.crossDay" class="tag cross">跨天</span>
          </td>
          <td><span v-if="shift.chained" class="tag chain">接续上一班</span><span v-else>—</span></td>
          <td>{{ personCell(shift, '带班人') }}</td>
          <td v-for="post in posts" :key="post">{{ personCell(shift, post) }}</td>
          <td>
            <span v-if="shift.gaps.length" class="gap-text">{{ shift.gaps.join('、') }}</span>
            <span v-else>无</span>
          </td>
          <td>{{ shift.status }}</td>
          <td class="row-actions">
            <template v-if="shift.status === '草稿'">
              <button class="link" type="button" @click="openEdit(shift)">编辑</button>
              <button class="link" type="button" @click="publish(shift)">发布排班</button>
            </template>
            <template v-else-if="!readonly">
              <button v-if="shift.status === '已发布'" class="link" type="button" @click="confirm(shift)">确认排班</button>
              <button v-if="shift.status === '已发布'" class="link" type="button" @click="revoke(shift)">撤回重排</button>
              <button v-if="shift.status === '已发布'" class="link" type="button" @click="openEdit(shift)">编辑</button>
              <button class="link" type="button" @click="openSwap(shift)">换班</button>
            </template>
            <span v-else class="readonly-text">只读</span>
          </td>
        </tr>
        <tr v-if="!shifts.length">
          <td :colspan="posts.length + 7" class="empty-state">暂无排班，可先新建班次</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">换班记录（谁让给谁、什么时候确认的，都留在这里）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>值班日期</th>
          <th>班次</th>
          <th>岗位</th>
          <th>让班人</th>
          <th>接班人</th>
          <th>申请时间</th>
          <th>确认时间</th>
          <th>状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="swap in swaps" :key="String(swap.id)">
          <td>{{ swap.值班日期 }}</td>
          <td>{{ swap.班次 }}</td>
          <td>{{ swap.岗位 }}</td>
          <td>{{ swap.让班人 }}</td>
          <td>{{ swap.接班人 }}</td>
          <td>{{ swap.申请时间 }}</td>
          <td>{{ swap.确认时间 || '—' }}</td>
          <td>{{ swap.status }}</td>
          <td class="row-actions">
            <template v-if="swap.status === '待确认' && !readonly">
              <button class="link" type="button" @click="confirmSwapRow(Number(swap.id))">确认换班</button>
              <button class="link" type="button" @click="rejectSwapRow(Number(swap.id))">退回</button>
            </template>
            <span v-else>—</span>
          </td>
        </tr>
        <tr v-if="!swaps.length">
          <td colspan="9" class="empty-state">暂无换班记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ shifts.length }} 个班次 · {{ swaps.length }} 笔换班</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="editor.visible" class="modal-mask" @click.self="editor.visible = false">
      <div class="modal-card">
        <h3 class="modal-title">{{ editor.mode === 'create' ? '新建班次' : '编辑班次人员' }}</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>值班日期</span>
            <input v-model="editor.值班日期" type="date" :disabled="editor.mode === 'edit'" />
          </label>
          <label class="form-item">
            <span>班次</span>
            <select v-model="editor.班次" :disabled="editor.mode === 'edit'">
              <option v-for="name in shiftNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </label>
          <label v-for="post in allPosts" :key="post" class="form-item">
            <span>{{ post }}</span>
            <input v-model="editor.people[post]" :placeholder="`填写${post}人员`" />
          </label>
        </div>
        <p class="modal-hint">带班人与各值守岗位都要填齐才能发布；同一个人在同一班次只能出现一次。</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="saveEditor">保存</button>
          <button class="btn ghost" type="button" @click="editor.visible = false">取消</button>
        </div>
      </div>
    </div>

    <div v-if="swapper.visible" class="modal-mask" @click.self="swapper.visible = false">
      <div class="modal-card">
        <h3 class="modal-title">发起换班 · {{ swapper.值班日期 }} {{ swapper.班次 }}</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>换班岗位（当前值班人）</span>
            <select v-model="swapper.post">
              <option v-for="option in swapOptions" :key="option.post" :value="option.post">
                {{ option.post }}（{{ option.holder }}）
              </option>
            </select>
          </label>
          <label class="form-item">
            <span>接班人</span>
            <input v-model="swapper.to" placeholder="填写接班人姓名" />
          </label>
        </div>
        <p class="modal-hint">换班确认后留痕：原值班人记录不动，接班人从确认那一刻起算。</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitSwap">提交换班申请</button>
          <button class="btn ghost" type="button" @click="swapper.visible = false">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  ALL_POSTS,
  REQUIRED_POSTS,
  SHIFT_NAMES,
  confirmShift,
  confirmSwap,
  createShift,
  listShifts,
  listSwaps,
  publishShift,
  rejectSwap,
  requestSwap,
  revokeShift,
  updateShift,
  type ShiftView,
} from '@/api/duty-service'
import { downloadEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const posts = REQUIRED_POSTS
const allPosts = ALL_POSTS
const shiftNames = SHIFT_NAMES

const shifts = ref<ShiftView[]>([])
const swaps = ref<EntryRow[]>([])
const errorMessage = ref('')
const okMessage = ref('')

const readonly = computed(() => store.role !== '值班长')

const stats = computed(() => [
  { label: '已发布班次', value: shifts.value.filter((item) => item.status === '已发布').length },
  { label: '岗位缺口班次', value: shifts.value.filter((item) => item.gaps.length > 0).length },
  { label: '待确认换班', value: swaps.value.filter((item) => String(item.status) === '待确认').length },
])

const editor = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  shiftId: 0,
  值班日期: '',
  班次: '白班',
  people: {} as Record<string, string>,
})

const swapper = reactive({
  visible: false,
  shiftId: 0,
  值班日期: '',
  班次: '',
  post: ALL_POSTS[0],
  to: '',
})

const swapOptions = computed(() => {
  const shift = shifts.value.find((item) => item.id === swapper.shiftId)
  if (!shift) {
    return []
  }
  return ALL_POSTS.map((post) => ({
    post,
    holder: shift.assignments.find((item) => item.岗位 === post)?.值班人 ?? '未排人',
  }))
})

function personCell(shift: ShiftView, post: string): string {
  const hit = shift.assignments.find((item) => item.岗位 === post)
  if (!hit) {
    return '—'
  }
  return hit.来源 === '换班' ? `${hit.值班人}（换）` : hit.值班人
}

function blankPeople(): Record<string, string> {
  return Object.fromEntries(ALL_POSTS.map((post) => [post, '']))
}

function openCreate() {
  Object.assign(editor, { visible: true, mode: 'create', shiftId: 0, 值班日期: '', 班次: '白班', people: blankPeople() })
}

function openEdit(shift: ShiftView) {
  const people = blankPeople()
  for (const item of shift.assignments) {
    people[item.岗位] = item.值班人
  }
  Object.assign(editor, {
    visible: true,
    mode: 'edit',
    shiftId: shift.id,
    值班日期: shift.值班日期,
    班次: shift.班次,
    people,
  })
}

function saveEditor() {
  const input = { 值班日期: editor.值班日期, 班次: editor.班次, people: editor.people }
  const result = editor.mode === 'create'
    ? createShift(input)
    : updateShift(editor.shiftId, input, store.role)
  report(result)
  if (result.ok) {
    editor.visible = false
  }
}

function publish(shift: ShiftView) {
  report(publishShift(shift.id, store.role))
}

function confirm(shift: ShiftView) {
  report(confirmShift(shift.id, store.role))
}

function revoke(shift: ShiftView) {
  report(revokeShift(shift.id, store.role))
}

function openSwap(shift: ShiftView) {
  Object.assign(swapper, {
    visible: true,
    shiftId: shift.id,
    值班日期: shift.值班日期,
    班次: shift.班次,
    post: ALL_POSTS[0],
    to: '',
  })
}

function submitSwap() {
  const result = requestSwap(swapper.shiftId, swapper.post, swapper.to, store.role)
  report(result)
  if (result.ok) {
    swapper.visible = false
  }
}

function confirmSwapRow(id: number) {
  report(confirmSwap(id, store.role))
}

function rejectSwapRow(id: number) {
  report(rejectSwap(id, store.role))
}

function exportRows() {
  downloadEntries('dutyschedule')
}

function report(result: { ok: boolean; message: string }) {
  if (result.ok) {
    okMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    okMessage.value = ''
  }
  reload()
}

function reload() {
  shifts.value = listShifts()
  swaps.value = listSwaps()
}

onMounted(reload)
</script>
