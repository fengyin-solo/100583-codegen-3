<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>交接班待办</h2>
        <p class="page-desc">
          排班确认之后，各班次的带班人与值守岗位结论自动带到待交接清单；换班确认后结论同步回写，同一班次始终只有一条。
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
        <button class="btn" type="button" @click="reload">刷新待办</button>
      </div>
    </header>

    <div v-if="!chief" class="readonly-banner">只读视图：交接确认由值班长执行，你可以查看本班次的待交接岗位结论。</div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待交接班次</span>
        <strong class="stat-value">{{ pendingRows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已交接班次</span>
        <strong class="stat-value">{{ doneRows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">结论来源排班单</span>
        <strong class="stat-value">{{ sheetCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>按日期检索</span>
        <input v-model="dateFilter" placeholder="如 2026-09-26" />
      </label>
      <label class="filter-item">
        <span>交接状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option value="待交接">待交接</option>
          <option value="已交接">已交接</option>
        </select>
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>值班日期</th>
          <th>班次</th>
          <th>带班人</th>
          <th v-for="post in posts" :key="post">{{ post }}</th>
          <th>结论来源 / 回写时间</th>
          <th>交接状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.id">
          <td>{{ row.date }}</td>
          <td>{{ row.shift }}<small v-if="row.shift === '夜班'" class="muted">（跨天）</small></td>
          <td><strong>{{ row.leader }}</strong></td>
          <td v-for="post in posts" :key="post">
            {{ assigneeOf(row, post) }}
            <small class="muted eff">{{ effectiveOf(row, post) }}</small>
          </td>
          <td>
            {{ row.source }}
            <small class="muted">{{ row.writtenAt }}</small>
          </td>
          <td>
            <span class="status-pill" :class="row.status === '已交接' ? 'st-done' : 'st-todo'">{{ row.status }}</span>
            <small v-if="row.handedAt" class="muted">{{ row.handedBy }} · {{ row.handedAt }}</small>
          </td>
          <td class="row-actions">
            <button
              v-if="chief && row.status === '待交接'"
              class="link"
              type="button"
              @click="complete(row.id)"
            >确认交接</button>
            <RouterLink v-if="chief" class="link" :to="`/schedule?sheet=${row.sheetId}`">查看排班</RouterLink>
            <span v-else-if="!chief" class="muted">只读</span>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td :colspan="posts.length + 5" class="empty-state">
            暂无待交接数据——排班确认后，这里会自动带出每个班次的交接结论
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>结论由排班确认自动带出，换班确认后按班次幂等回写，不会重复生成第二条。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { listPosts } from '@/api/schedule-service'
import { completeHandover, listHandovers } from '@/api/schedule-service'
import type { HandoverTodo } from '@/data/schedule-types'

const store = useSessionStore()
const chief = computed(() => store.isChief)
const posts = listPosts()

const rows = ref<HandoverTodo[]>([])
const dateFilter = ref('')
const statusFilter = ref('')
const message = ref('')
const messageOk = ref(false)

function actor() {
  return { name: store.operator, role: store.role }
}

function onRoleChange(event: Event) {
  const role = (event.target as HTMLSelectElement).value as '值班长' | '值班员'
  const name = role === '值班长' ? '张建国' : '李永强'
  store.setIdentity(name, role)
}

function reload() {
  rows.value = listHandovers()
}

const pendingRows = computed(() => rows.value.filter((item) => item.status === '待交接'))
const doneRows = computed(() => rows.value.filter((item) => item.status === '已交接'))
const sheetCount = computed(() => new Set(rows.value.map((item) => item.sheetId)).size)

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    if (dateFilter.value.trim() && !row.date.includes(dateFilter.value.trim())) {
      return false
    }
    if (statusFilter.value && row.status !== statusFilter.value) {
      return false
    }
    return true
  }),
)

function assigneeOf(row: HandoverTodo, post: string): string {
  return row.posts.find((item) => item.post === post)?.assignee ?? '—'
}

function effectiveOf(row: HandoverTodo, post: string): string {
  const at = row.posts.find((item) => item.post === post)?.effectiveSince ?? ''
  return at ? `自 ${at.slice(5, 16)}` : ''
}

function complete(id: number) {
  const result = completeHandover(id, actor())
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

onMounted(reload)
</script>

<style scoped>
.readonly-banner {
  background: #fff7ed; border: 1px solid #fdba74; color: #9a3412;
  border-radius: 8px; padding: 8px 12px; font-size: 13px;
}
.identity-box { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.identity-box select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; }
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; display: inline-block; }
.st-todo { background: #fef3c7; color: #92400e; }
.st-done { background: #dcfce7; color: #166534; }
.eff { display: block; font-size: 10px; }
.filter-item select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; }
</style>
