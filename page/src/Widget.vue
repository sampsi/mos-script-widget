<template>
  <div>
    <div v-if="loading" class="d-flex justify-center pa-4">
      <v-progress-circular indeterminate size="24" width="2" />
    </div>
    <div v-else-if="visible.length === 0" class="text-center pa-3">
      <v-icon size="32" color="grey" class="mb-2">mdi-script-text-outline</v-icon>
      <div class="text-body-2 text-medium-emphasis">{{ $t('plugin_script_widget.empty') }}</div>
    </div>
    <div v-else>
      <div v-for="s in visible" :key="s.id" class="sw-row d-flex align-center">
        <div class="sw-icon">
          <v-icon size="22" :color="iconColor(s)">{{ s.icon || 'mdi-script-text-outline' }}</v-icon>
          <span class="sw-dot" :class="dotClass(s)" />
        </div>
        <div class="sw-text">
          <div class="text-body-2 sw-name" :title="s.path">{{ s.name || s.path }}</div>
          <div class="text-caption text-medium-emphasis sw-sub">{{ subtitle(s) }}</div>
        </div>
        <v-progress-circular v-if="busy[s.id]" indeterminate size="16" width="2" class="mr-2" />
        <template v-else-if="isRunning(s)">
          <v-btn size="small" variant="text" icon="mdi-text-box-search-outline" :title="$t('plugin_script_widget.show_log')" @click="openLog(s, 'view')" />
          <v-btn size="small" variant="text" color="error" icon="mdi-stop" :title="$t('plugin_script_widget.stop')" @click="stop(s)" />
        </template>
        <template v-else>
          <v-btn size="small" variant="text" color="primary" icon="mdi-play" :title="$t('plugin_script_widget.run_background')" @click="ask(s, 'background')" />
          <v-btn size="small" variant="text" icon="mdi-console" :title="$t('plugin_script_widget.run_log')" @click="ask(s, 'live')" />
          <v-btn
            size="small"
            variant="text"
            icon="mdi-text-box-outline"
            :disabled="!statuses[s.id]"
            :title="$t('plugin_script_widget.show_log')"
            @click="openLog(s, 'view')"
          />
        </template>
      </div>
      <div v-if="message" class="text-caption mt-1" :class="messageError ? 'text-error' : 'text-medium-emphasis'">{{ message }}</div>
    </div>

    <v-dialog v-model="confirmOpen" max-width="420">
      <v-card>
        <v-card-title>{{ confirmScript?.name }}</v-card-title>
        <v-card-text>
          {{ $t('plugin_script_widget.confirm_run') }}<br />
          <code class="text-caption">{{ confirmScript?.path }} {{ confirmScript?.args }}</code>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">{{ $t('plugin_script_widget.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" @click="confirmed">{{ $t('plugin_script_widget.run') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <LogDialog v-model="logOpen" :script="logScript" :mode="logMode" @changed="refreshStatuses" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue';
import LogDialog from './LogDialog.vue';
import { useScripts, usePolling, runBackground, stopScript, ago, duration } from './useScripts.js';

const { proxy } = getCurrentInstance();
const t = (...a) => proxy.$t(...a);

const { settings, statuses, loading, load, refreshStatuses } = useScripts();
const busy = reactive({});
const poll = usePolling(refreshStatuses, 4);
const message = ref('');
const messageError = ref(false);

const logOpen = ref(false);
const logScript = ref(null);
const logMode = ref('view');
const confirmOpen = ref(false);
const confirmScript = ref(null);
let confirmMode = 'background';

const visible = computed(() => settings.value.scripts.filter((s) => s.showInWidget !== false && s.path));
const isRunning = (s) => statuses.value[s.id]?.state === 'running';

const dotClass = (s) => {
  const st = statuses.value[s.id]?.state;
  return { running: 'sw-blue', ok: 'sw-green', error: 'sw-red' }[st] || 'sw-none';
};
const iconColor = (s) => (isRunning(s) ? 'primary' : undefined);

const subtitle = (s) => {
  const st = statuses.value[s.id];
  if (!st) return t('plugin_script_widget.never_run');
  if (st.state === 'running') return `${t('plugin_script_widget.running')} · ${duration(st)}`;
  const when = ago(st.end || st.start, t);
  if (st.state === 'ok') return `${t('plugin_script_widget.ok')} · ${when} · ${duration(st)}`;
  if (st.stopped) return `${t('plugin_script_widget.stopped')} · ${when}`;
  return `${t('plugin_script_widget.failed')} (${st.code}) · ${when}`;
};

const flash = (text, error = false) => {
  message.value = text;
  messageError.value = error;
  setTimeout(() => {
    if (message.value === text) message.value = '';
  }, 6000);
};

const openLog = (s, mode) => {
  logScript.value = s;
  logMode.value = mode;
  logOpen.value = true;
};

const runNow = async (s, mode) => {
  if (mode === 'live') {
    openLog(s, 'live');
    return;
  }
  busy[s.id] = true;
  try {
    await runBackground(s);
    flash(t('plugin_script_widget.started', { name: s.name || s.path }));
    setTimeout(refreshStatuses, 1200);
  } catch (e) {
    flash(e.status === 403 ? t('plugin_script_widget.forbidden') : `${t('plugin_script_widget.run_failed')}: ${e.message}`, true);
  } finally {
    setTimeout(() => (busy[s.id] = false), 1200);
  }
};

const ask = (s, mode) => {
  if (s.confirm) {
    confirmScript.value = s;
    confirmMode = mode;
    confirmOpen.value = true;
  } else {
    runNow(s, mode);
  }
};
const confirmed = () => {
  confirmOpen.value = false;
  runNow(confirmScript.value, confirmMode);
};

const stop = async (s) => {
  busy[s.id] = true;
  try {
    await stopScript(s);
    setTimeout(refreshStatuses, 2500);
  } catch (e) {
    flash(e.message, true);
  } finally {
    setTimeout(() => (busy[s.id] = false), 2500);
  }
};

onMounted(async () => {
  await load();
  poll.start(4);
});
onUnmounted(() => poll.stop());
</script>

<style scoped>
.sw-row {
  gap: 6px;
  padding: 3px 0;
  min-width: 0;
}
.sw-row + .sw-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.sw-icon {
  position: relative;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sw-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-surface));
}
.sw-green {
  background: #4caf50;
}
.sw-red {
  background: #f44336;
}
.sw-blue {
  background: #2196f3;
  animation: sw-pulse 1.2s ease-in-out infinite;
}
.sw-none {
  display: none;
}
@keyframes sw-pulse {
  50% {
    opacity: 0.35;
  }
}
.sw-text {
  flex: 1;
  min-width: 0;
}
.sw-name,
.sw-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}
</style>
