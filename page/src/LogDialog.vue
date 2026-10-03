<template>
  <v-dialog :model-value="modelValue" max-width="980" scrollable @update:model-value="(v) => !v && close()">
    <v-card>
      <v-card-title class="d-flex align-center" style="gap: 10px">
        <v-icon>{{ script?.icon || 'mdi-script-text-outline' }}</v-icon>
        <span class="text-truncate">{{ script?.name }}</span>
        <v-chip v-if="state" size="small" variant="tonal" :color="stateColor">{{ stateText }}</v-chip>
        <v-spacer />
        <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 40%">{{ script?.path }}</span>
      </v-card-title>
      <v-card-text class="pa-0">
        <pre ref="pre" class="sw-log">{{ text || (loadingLog ? '' : $t('plugin_script_widget.no_output')) }}</pre>
        <v-progress-linear v-if="following" indeterminate color="primary" height="2" />
      </v-card-text>
      <v-card-actions>
        <span v-if="errorText" class="text-error text-body-2 ml-2">{{ errorText }}</span>
        <v-spacer />
        <v-btn v-if="running" color="error" variant="text" prepend-icon="mdi-stop" :loading="stopping" @click="stop">
          {{ $t('plugin_script_widget.stop') }}
        </v-btn>
        <v-btn variant="text" prepend-icon="mdi-content-copy" @click="copy">{{ $t('plugin_script_widget.copy') }}</v-btn>
        <v-btn variant="text" @click="close">{{ $t('plugin_script_widget.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted, getCurrentInstance } from 'vue';
import { runLive, readLog, readStatus, stopScript, terminalToText, duration } from './useScripts.js';

const props = defineProps({
  modelValue: Boolean,
  script: Object,
  mode: { type: String, default: 'view' }, // live = run now and follow, view = show latest log
});
const emit = defineEmits(['update:modelValue', 'changed']);
// MOS:n oma i18n (vue-i18n ei ole jaettu moduuli, joten kaytetaan isannan $t:ta)
const { proxy } = getCurrentInstance();
const t = (...a) => proxy.$t(...a);

const text = ref('');
const pre = ref(null);
const state = ref(null);
const following = ref(false);
const loadingLog = ref(false);
const stopping = ref(false);
const errorText = ref('');
let handle = null;
let poll = null;

const running = computed(() => state.value?.state === 'running');
const stateColor = computed(() => ({ running: 'primary', ok: 'green', error: 'red' })[state.value?.state] || 'grey');
const stateText = computed(() => {
  const st = state.value;
  if (!st) return '';
  if (st.state === 'running') return `${t('plugin_script_widget.running')} · ${duration(st)}`;
  if (st.state === 'ok') return `${t('plugin_script_widget.ok')} · ${duration(st)}`;
  if (st.stopped) return t('plugin_script_widget.stopped');
  return `${t('plugin_script_widget.failed')} (${st.code})`;
});

const scrollDown = async () => {
  await nextTick();
  const el = pre.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
};

const refreshState = async () => {
  if (props.script) state.value = await readStatus(props.script);
};

const startPolling = () => {
  stopPolling();
  poll = setInterval(async () => {
    await refreshState();
    if (props.mode === 'view') {
      const log = await readLog(props.script);
      if (log !== null && log !== text.value) {
        text.value = log;
        scrollDown();
      }
      if (!running.value) stopPolling();
    }
  }, 2000);
};
const stopPolling = () => {
  if (poll) clearInterval(poll);
  poll = null;
};

const open = async () => {
  text.value = '';
  errorText.value = '';
  state.value = null;
  if (!props.script) return;
  if (props.mode === 'live') {
    following.value = true;
    try {
      handle = await runLive(props.script, {
        onOutput: (chunk) => {
          text.value = terminalToText(text.value, chunk);
          scrollDown();
        },
        onExit: async () => {
          following.value = false;
          await refreshState();
          emit('changed');
        },
        onError: (msg) => {
          errorText.value = msg;
        },
      });
      setTimeout(refreshState, 800);
      startPolling();
    } catch (e) {
      following.value = false;
      errorText.value = e.status === 403 ? t('plugin_script_widget.forbidden') : `${t('plugin_script_widget.run_failed')}: ${e.message}`;
    }
  } else {
    loadingLog.value = true;
    await refreshState();
    text.value = (await readLog(props.script)) ?? '';
    loadingLog.value = false;
    scrollDown();
    if (running.value) startPolling();
  }
};

const stop = async () => {
  stopping.value = true;
  try {
    await stopScript(props.script);
    setTimeout(async () => {
      await refreshState();
      stopping.value = false;
      emit('changed');
    }, 2500);
  } catch (e) {
    stopping.value = false;
    errorText.value = e.message;
  }
};

const copy = () => navigator.clipboard?.writeText(text.value);

const close = () => {
  handle?.close();
  handle = null;
  following.value = false;
  stopPolling();
  emit('update:modelValue', false);
  emit('changed');
};

watch(
  () => props.modelValue,
  (v) => v && open(),
);
onUnmounted(() => {
  handle?.close();
  stopPolling();
});
</script>

<style scoped>
.sw-log {
  margin: 0;
  padding: 12px 16px;
  min-height: 320px;
  max-height: 65vh;
  overflow: auto;
  background: #0f1115;
  color: #d7dae0;
  font-family: ui-monospace, 'JetBrains Mono', 'DejaVu Sans Mono', monospace;
  font-size: 12.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
