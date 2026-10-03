<template>
  <div style="margin-bottom: 80px">
    <h2 class="mb-1">{{ $t('plugin_script_widget.title') }}</h2>
    <div class="text-body-2 text-medium-emphasis mb-4">{{ $t('plugin_script_widget.intro') }}</div>
    <v-skeleton-loader v-if="loading" :loading="true" type="card" />
    <template v-else>
      <v-card v-for="(s, i) in form.scripts" :key="s.id" class="mb-3 pa-0">
        <v-card-text class="pa-4">
          <v-row dense>
            <v-col cols="12" md="3">
              <v-text-field v-model="s.name" :label="$t('plugin_script_widget.name')" density="compact" variant="outlined" hide-details />
            </v-col>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="s.path"
                :label="$t('plugin_script_widget.path')"
                placeholder="/mnt/data/run.sh"
                density="compact"
                variant="outlined"
                hide-details
                prepend-inner-icon="mdi-file-code-outline"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="s.args" :label="$t('plugin_script_widget.args')" density="compact" variant="outlined" hide-details />
            </v-col>
            <v-col cols="12" md="3">
              <v-text-field
                v-model="s.icon"
                :label="$t('plugin_script_widget.icon')"
                placeholder="mdi-script-text-outline"
                density="compact"
                variant="outlined"
                hide-details
              >
                <template #prepend-inner><v-icon size="20">{{ s.icon || 'mdi-script-text-outline' }}</v-icon></template>
              </v-text-field>
            </v-col>
            <v-col cols="12" md="3" class="d-flex align-center">
              <v-switch v-model="s.showInWidget" :label="$t('plugin_script_widget.show_in_widget')" color="primary" density="compact" hide-details />
            </v-col>
            <v-col cols="12" md="3" class="d-flex align-center">
              <v-switch v-model="s.confirm" :label="$t('plugin_script_widget.confirm')" color="primary" density="compact" hide-details />
            </v-col>
            <v-col cols="12" md="3" class="d-flex align-center justify-end" style="gap: 2px">
              <v-btn size="small" variant="text" icon="mdi-console" :disabled="!s.path" :title="$t('plugin_script_widget.run_log')" @click="test(s)" />
              <v-btn size="small" variant="text" icon="mdi-arrow-up" :disabled="i === 0" @click="move(i, -1)" />
              <v-btn size="small" variant="text" icon="mdi-arrow-down" :disabled="i === form.scripts.length - 1" @click="move(i, 1)" />
              <v-btn size="small" variant="text" color="error" icon="mdi-delete-outline" :title="$t('plugin_script_widget.remove')" @click="remove(i)" />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <div v-if="form.scripts.length === 0" class="text-body-2 text-medium-emphasis mb-3">{{ $t('plugin_script_widget.none_yet') }}</div>

      <div class="d-flex align-center flex-wrap" style="gap: 12px">
        <v-btn variant="tonal" prepend-icon="mdi-plus" @click="add">{{ $t('plugin_script_widget.add') }}</v-btn>
        <v-btn color="primary" :loading="saving" prepend-icon="mdi-content-save" @click="save">{{ $t('plugin_script_widget.save') }}</v-btn>
        <span v-if="saved" class="text-body-2 text-success">{{ $t('plugin_script_widget.saved') }}</span>
        <span v-if="saveFailed" class="text-body-2 text-error">{{ $t('plugin_script_widget.save_failed') }}</span>
      </div>

      <v-card class="mt-6 pa-0" variant="outlined">
        <v-card-text class="text-body-2 text-medium-emphasis">
          <div class="mb-1"><v-icon size="16" class="mr-1">mdi-play</v-icon>{{ $t('plugin_script_widget.help_background') }}</div>
          <div class="mb-1"><v-icon size="16" class="mr-1">mdi-console</v-icon>{{ $t('plugin_script_widget.help_live') }}</div>
          <div><v-icon size="16" class="mr-1">mdi-folder-outline</v-icon>{{ $t('plugin_script_widget.help_logs') }}</div>
        </v-card-text>
      </v-card>
    </template>

    <LogDialog v-model="logOpen" :script="logScript" mode="live" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import LogDialog from './LogDialog.vue';
import { loadSettings, saveSettings, newScript, DEFAULT_SETTINGS } from './useScripts.js';

const loading = ref(true);
const form = ref({ ...DEFAULT_SETTINGS, scripts: [] });
const saving = ref(false);
const saved = ref(false);
const saveFailed = ref(false);
const logOpen = ref(false);
const logScript = ref(null);

const add = () => form.value.scripts.push(newScript());
const remove = (i) => form.value.scripts.splice(i, 1);
const move = (i, d) => {
  const list = form.value.scripts;
  [list[i], list[i + d]] = [list[i + d], list[i]];
};

const cleaned = () => ({
  ...form.value,
  scripts: form.value.scripts
    .filter((s) => s.path.trim())
    .map((s) => ({
      id: s.id,
      name: s.name.trim() || s.path.trim().split('/').pop(),
      path: s.path.trim(),
      args: (s.args || '').trim(),
      icon: (s.icon || '').trim() || 'mdi-script-text-outline',
      confirm: !!s.confirm,
      showInWidget: s.showInWidget !== false,
    })),
});

const save = async () => {
  saving.value = true;
  saved.value = false;
  saveFailed.value = false;
  const s = cleaned();
  const ok = await saveSettings(s);
  form.value = s;
  saving.value = false;
  saved.value = ok;
  saveFailed.value = !ok;
};

// Testaa: ajaa skriptin lokin kanssa (tallentamattomillakin tiedoilla)
const test = (s) => {
  logScript.value = { ...s, name: s.name || s.path };
  logOpen.value = true;
};

onMounted(async () => {
  form.value = await loadSettings();
  loading.value = false;
});
</script>
