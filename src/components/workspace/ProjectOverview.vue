<template>
  <section class="project-overview">
    <header>
      <div>
        <h1>Project overview</h1>
        <p>Tasks and repository changes for this workspace.</p>
      </div>
      <form class="new-task-form" @submit.prevent="createTask">
        <input v-model="taskName" type="text" maxlength="200" placeholder="Task name" aria-label="New task name">
        <AppButton type="submit" variant="primary" :disabled="!taskName.trim()">+ New task</AppButton>
      </form>
    </header>

    <div class="overview-grid">
      <section class="overview-section tasks-section">
        <div class="section-heading"><h2>Tasks</h2><small>{{ tasks.length }}</small></div>
        <div v-if="tasks.length" class="task-list">
          <AppButton v-for="task in tasks" :key="task.id" type="button" variant="subtle" class="task-row" @click="$emit('select-task', task.id)">
            <span>{{ task.name }}</span><small>{{ task.mounted ? 'Mounted' : task.completionSeen ? 'Complete' : 'Active' }}</small>
          </AppButton>
        </div>
        <p v-else class="empty">No active tasks yet.</p>
        <div class="archive-heading"><h2>Archive</h2><small>{{ archivedTasks.length }}</small></div>
        <div v-if="archivedTasks.length" class="task-list archive-list">
          <div v-for="task in visibleArchivedTasks" :key="task.id" class="task-row archived-task"><span>{{ task.name }}</span><small>Archived</small></div>
        </div>
        <AppButton v-if="visibleArchivedTasks.length < archivedTasks.length" class="show-more-archive" size="small" variant="subtle" type="button" @click="visibleArchiveCount += 12">Show 12 more</AppButton>
        <p v-else-if="!archivedTasks.length" class="empty">No archived tasks.</p>
      </section>

      <section class="overview-section repositories-section">
        <div class="section-heading"><h2>Repositories</h2><AppButton size="small" type="button" :disabled="loading" @click="load">{{ loading ? 'Refreshing…' : 'Refresh' }}</AppButton></div>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-else-if="!repositories.length && !loading" class="empty">No Git repository found in this workspace.</p>
        <article v-for="repository in repositories" :key="repository.root" class="repository-card">
          <div class="repository-heading">
            <strong class="repository-name">{{ repository.name }}</strong>
            <small class="repository-path" :title="repository.root">{{ repository.root }}</small>
            <div class="repository-meta">
              <span class="repository-branch">{{ repository.branch || 'Detached HEAD' }}</span>
              <span class="change-chip staged">{{ repository.staged.length }} staged</span>
              <span class="change-chip unstaged">{{ repository.unstaged.length }} unstaged</span>
            </div>
            <span class="repository-change-label">Active changes in project</span>
          </div>
          <details class="repository-changes">
            <summary>Stage, review &amp; commit</summary>
            <div class="change-columns">
            <div><h3>Unstaged</h3><ul><li v-for="change in repository.unstaged" :key="`unstaged-${change.path}`"><code :class="`git-change-${change.status.toLowerCase()}`">{{ change.status }}</code><span class="change-path" :title="change.path">{{ change.path }}</span><AppButton size="small" variant="subtle" type="button" aria-label="Stage file" title="Stage file" @click="updateIndex(repository, 'stage', change.path)">Stage</AppButton></li><li v-if="!repository.unstaged.length" class="empty">Working tree clean</li></ul></div>
            <div><h3>Staged</h3><ul><li v-for="change in repository.staged" :key="`staged-${change.path}`"><code :class="`git-change-${change.status.toLowerCase()}`">{{ change.status }}</code><span class="change-path" :title="change.path">{{ change.path }}</span><AppButton size="small" variant="subtle" type="button" aria-label="Unstage file" title="Unstage file" @click="updateIndex(repository, 'unstage', change.path)">Unstage</AppButton></li><li v-if="!repository.staged.length" class="empty">Nothing staged</li></ul></div>
          </div>
            <form class="commit-form" @submit.prevent="commit(repository)">
              <textarea v-model="messages[repository.root]" rows="2" placeholder="Commit message" aria-label="Commit message"></textarea>
              <AppButton type="submit" variant="primary" :disabled="busy === repository.root || !repository.staged.length || !messages[repository.root]?.trim()">{{ busy === repository.root ? 'Committing…' : 'Commit staged changes' }}</AppButton>
            </form>
          </details>
        </article>
      </section>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../ui/AppButton.vue";

export default defineComponent({
  name: "ProjectOverview",
  components: { AppButton },
  emits: ["create-task", "select-task"],
  props: {
    workspace: { type: Object as PropType<WorkspaceRecord>, required: true },
    tasks: { type: Array as PropType<Array<WorkspaceTaskRecord & { mounted?: boolean }>>, required: true },
  },
  data() {
    return { repositories: [] as GitRepository[], messages: {} as Record<string, string>, taskName: "", visibleArchiveCount: 6, loading: false, busy: "", error: "" };
  },
  computed: {
    archivedTasks(): WorkspaceTaskRecord[] {
      return this.workspace.tasks.filter((task) => Boolean(task.completedAt)).sort((left, right) =>
        (right.completedAt ?? "").localeCompare(left.completedAt ?? ""),
      );
    },
    visibleArchivedTasks(): WorkspaceTaskRecord[] {
      return this.archivedTasks.slice(0, this.visibleArchiveCount);
    },
  },
  watch: { workspace: { immediate: true, handler() { void this.load(); } } },
  methods: {
    createTask() {
      const name = this.taskName.trim();
      if (!name) return;
      this.$emit("create-task", name);
      this.taskName = "";
    },
    async load() {
      if (!window.hardcode) return;
      this.loading = true;
      this.error = "";
      try { this.repositories = await window.hardcode.git.status(this.workspace.id); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      finally { this.loading = false; }
    },
    async updateIndex(repository: GitRepository, action: "stage" | "unstage", filePath: string) {
      if (!window.hardcode || this.busy) return;
      this.busy = repository.root;
      this.error = "";
      try { await window.hardcode.git.updateIndex(this.workspace.id, repository.root, action, filePath); await this.load(); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      finally { this.busy = ""; }
    },
    async commit(repository: GitRepository) {
      const message = this.messages[repository.root]?.trim();
      if (!message || !window.hardcode) return;
      this.busy = repository.root;
      this.error = "";
      try { await window.hardcode.git.commit(this.workspace.id, repository.root, message); this.messages[repository.root] = ""; await this.load(); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      finally { this.busy = ""; }
    },
  },
});
</script>

<style scoped>
.project-overview {
  min-width: 0;
  min-height: 0;
  padding: 24px;
  overflow: auto;
  color: var(--color-text);
  font: 13px/1.45 system-ui, sans-serif;
}

.project-overview > header,
.section-heading,
.repository-heading,
.repository-summary,
.commit-form,
.new-task-form {
  display: flex;
  gap: 12px;
  align-items: center;
}

.project-overview > header {
  justify-content: space-between;
  max-width: 1100px;
  margin: 0 auto 28px;
}

.new-task-form input {
  width: 180px;
  padding: 7px 9px;
  border: 1px solid var(--color-border-strong);
  border-radius: 7px;
  color: var(--color-text);
  background: var(--color-panel);
  font: inherit;
}

.new-task-form input:focus,
.commit-form textarea:focus {
  outline: none;
  border-color: var(--basic-border-focus);
}

.project-overview h1,
.project-overview h2,
.project-overview h3 {
  margin: 0;
  color: var(--basic-text-heading);
}

.project-overview h1 { font-size: 20px; }
.project-overview h2 { font-size: 15px; }
.project-overview h3 { color: var(--color-text-secondary); font-size: 12px; }
.project-overview p { margin: 4px 0 0; color: var(--color-text-secondary); }

.overview-grid {
  display: grid;
  grid-template-columns: minmax(250px, .75fr) minmax(0, 1.5fr);
  gap: 24px;
  max-width: 1100px;
  margin: 0 auto;
  align-items: start;
}

.overview-section {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-panel);
}

.section-heading,
.archive-heading { justify-content: space-between; }
.section-heading small,
.archive-heading small,
.task-row small { color: var(--color-text-secondary); }

.task-list { display: grid; grid-template-columns: 1fr; gap: 7px; margin-top: 14px; }
.task-row.app-button,
.archived-task { display: flex; justify-content: space-between; padding: 10px; text-align: left; }
.archive-heading { display: flex; gap: 12px; align-items: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--basic-border-subtle); }
.archive-list { max-height: 310px; padding-right: 3px; overflow-y: auto; }
.archived-task { border: 1px solid var(--basic-border-subtle); border-radius: 7px; color: var(--color-text-secondary); }
.show-more-archive.app-button { width: 100%; margin-top: 8px; }
.empty { color: var(--color-text-secondary); }
.error { margin: 12px 0; color: var(--state-error) !important; }

.repository-card {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--basic-border-subtle);
  border-radius: 9px;
  background: var(--color-elevated);
}

.repository-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
  align-items: start;
}

.repository-name { grid-column: 1; grid-row: 1; min-width: 0; }
.repository-path { grid-column: 1; grid-row: 2; min-width: 0; overflow: hidden; color: var(--color-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.repository-branch,
.change-columns code { color: var(--accent-icon); }

.repository-heading > .repository-meta {
  display: flex;
  grid-column: 2;
  grid-row: 1;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  align-items: center;
}

.repository-change-label {
  grid-column: 2;
  grid-row: 2;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: right;
}

.change-columns code.git-change-a,
.change-columns code.git-change-\? { color: var(--state-success); }
.change-columns code.git-change-m,
.change-columns code.git-change-r { color: var(--feature-diff-modified); }
.change-columns code.git-change-d { color: var(--state-attention); }
.change-chip {
  padding: 3px 7px;
  border: 1px solid var(--color-border-strong);
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
}

.change-chip.staged {
  color: var(--state-success-text);
  border-color: var(--state-complete-border);
}

.change-chip.unstaged {
  color: var(--feature-diff-modified);
  border-color: var(--feature-diff-modified);
}

.repository-changes {
  margin-top: 14px;
  border-top: 1px solid var(--basic-border-subtle);
}

.repository-changes summary {
  padding: 10px 0;
  color: var(--basic-text-label);
  cursor: pointer;
  font-size: 12px;
  user-select: none;
}

.repository-changes summary:hover { color: var(--color-text); }
.repository-changes[open] summary { border-bottom: 1px solid var(--basic-border-subtle); }

.change-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; margin-top: 14px; }
.change-columns > div { min-width: 0; }
.change-columns ul { margin: 6px 0 0; padding: 0; list-style: none; }
.change-columns li { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 5px; align-items: center; min-width: 0; padding: 3px 0; }
.change-columns code { grid-column: 1; width: 28px; }
.change-columns li .change-path {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  direction: rtl;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.change-columns li .app-button { grid-column: 3; }

.commit-form { align-items: stretch; margin-top: 14px; }
.commit-form textarea {
  flex: 1;
  padding: 8px;
  resize: vertical;
  border: 1px solid var(--color-border-strong);
  border-radius: 7px;
  color: var(--color-text);
  background: var(--color-panel);
  font: inherit;
}

@media (max-width: 760px) {
  .overview-grid,
  .change-columns { grid-template-columns: 1fr; }
  .commit-form { flex-direction: column; }
}
</style>
