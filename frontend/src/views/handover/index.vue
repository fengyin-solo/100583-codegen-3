<template>
  <section class="page" data-module="handover">
    <header class="page-head">
      <div>
        <h2>交接班待办</h2>
        <p class="page-desc">排班确认的结论自动回写到待交接清单，同一个人在同一班次只留一条；交接完成后归档。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出待交接清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>值班日期</span>
        <input v-model="filters.值班日期" placeholder="按值班日期检索" />
      </label>
      <label class="filter-item">
        <span>值班人</span>
        <input v-model="filters.值班人" placeholder="按值班人检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>值班日期</th>
          <th>班次</th>
          <th>值班人</th>
          <th>岗位</th>
          <th>交接事项</th>
          <th>来源</th>
          <th>生成时间</th>
          <th>交接时间</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row.值班日期 }}</td>
          <td>{{ row.班次 }}</td>
          <td>{{ row.值班人 }}</td>
          <td>{{ row.岗位 }}</td>
          <td>{{ row.交接事项 }}</td>
          <td>{{ row.来源 }}</td>
          <td>{{ row.生成时间 }}</td>
          <td>{{ row.交接时间 || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button v-if="row.status === '待交接'" class="link" type="button" @click="complete(Number(row.id))">
              完成交接
            </button>
            <span v-else>—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty-state">暂无待交接事项，排班确认后会自动带出来</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条交接事项</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { completeHandover, listHandover } from '@/api/duty-service'
import { downloadEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const rows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({ 值班日期: '', 值班人: '' })
const errorMessage = ref('')
const okMessage = ref('')

const stats = computed(() => {
  const people = new Set(rows.value.map((row) => String(row.值班人)))
  return [
    { label: '待交接事项', value: rows.value.filter((row) => String(row.status) === '待交接').length },
    { label: '已交接事项', value: rows.value.filter((row) => String(row.status) === '已交接').length },
    { label: '涉及值班员', value: people.size },
  ]
})

function complete(id: number) {
  const result = completeHandover(id)
  if (result.ok) {
    okMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    okMessage.value = ''
  }
  reload()
}

function exportRows() {
  downloadEntries('handover')
}

function resetFilters() {
  filters.value = { 值班日期: '', 值班人: '' }
  reload()
}

function reload() {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  rows.value = listHandover().filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

onMounted(reload)
</script>
