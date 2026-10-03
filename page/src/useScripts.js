// Shared data layer for the widget and the plugin page. Talks only to the MOS API:
//   GET/POST /api/v1/mos/plugins/settings/script-widget     script list (persisted on /boot)
//   POST     /api/v1/terminal/create                        runs the runner (admin only)
//   socket.io namespace /terminal (path /api/v1/socket.io/)  live output of a "run with log"
//   GET      /api/v1/system/logs/content?path=...            reads status + log from /var/log
//
// Every run goes through RUNNER (bash -c), which writes to /var/log/script-widget/:
//   <id>.log     output of the latest run
//   <id>.status  {"state":"running|ok|error","start":..,"end":..,"code":..}
//   <id>.pid     process group of a running script (used by "stop")
// The script path and arguments are passed as positional parameters, never interpolated
// into the shell string.
import { ref } from 'vue';
import { io } from 'socket.io-client';

export const PLUGIN = 'script-widget';
export const LOG_DIR = 'script-widget';

export const DEFAULT_SETTINGS = {
  scripts: [],
};

export const newScript = () => ({
  id: Math.random().toString(36).slice(2, 10),
  name: '',
  path: '',
  args: '',
  icon: 'mdi-script-text-outline',
  confirm: false,
  showInWidget: true,
});

const authHeaders = () => ({
  Authorization: 'Bearer ' + localStorage.getItem('authToken'),
});

export async function loadSettings() {
  try {
    const res = await fetch(`/api/v1/mos/plugins/settings/${PLUGIN}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return {
      ...DEFAULT_SETTINGS,
      ...data,
      scripts: Array.isArray(data?.scripts) ? data.scripts.map((s) => ({ ...newScript(), ...s })) : [],
    };
  } catch {
    return { ...DEFAULT_SETTINGS, scripts: [] };
  }
}

export async function saveSettings(settings) {
  const res = await fetch(`/api/v1/mos/plugins/settings/${PLUGIN}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.ok;
}

// $1 = id, $2 = mode (live|background), $3 = script path, $4.. = arguments
const RUNNER = String.raw`
D=/var/log/script-widget; ID="$1"; MODE="$2"; P="$3"; shift 3
mkdir -p "$D"; L="$D/$ID.log"; S="$D/$ID.status"
if [ -f "$D/$ID.pid" ] && kill -0 "$(cat "$D/$ID.pid")" 2>/dev/null; then
  echo "Script is already running (pid $(cat "$D/$ID.pid"))."; exit 3
fi
if [ ! -f "$P" ]; then
  echo "Script not found: $P" | tee "$L"
  printf '{"state":"error","start":%s,"end":%s,"code":127}\n' "$(date +%s)" "$(date +%s)" > "$S"; exit 127
fi
echo $$ > "$D/$ID.pid"
START=$(date +%s)
printf '{"state":"running","start":%s}\n' "$START" > "$S"
echo "=== $(date '+%Y-%m-%d %H:%M:%S')  $P $*" > "$L"
if [ -x "$P" ]; then CMD=("$P" "$@"); else CMD=(bash "$P" "$@"); fi
if [ "$MODE" = live ]; then
  "\${CMD[@]}" 2>&1 | tee -a "$L"; CODE=\${PIPESTATUS[0]}
else
  "\${CMD[@]}" >> "$L" 2>&1; CODE=$?
fi
END=$(date +%s)
if [ "$CODE" = 0 ]; then ST=ok; else ST=error; fi
echo "=== finished in $((END - START)) s, exit code $CODE" | tee -a "$L" >/dev/null
[ "$MODE" = live ] && echo "=== finished in $((END - START)) s, exit code $CODE"
printf '{"state":"%s","start":%s,"end":%s,"code":%s}\n' "$ST" "$START" "$END" "$CODE" > "$S"
rm -f "$D/$ID.pid"
`.replace(/\\\$/g, '$');

const STOP = String.raw`
F=/var/log/script-widget/$1.pid
[ -f "$F" ] || { echo "not running"; exit 0; }
PID=$(cat "$F")
kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null
sleep 2; kill -KILL -- "-$PID" 2>/dev/null
rm -f "$F"
printf '{"state":"error","start":%s,"end":%s,"code":143,"stopped":true}\n' "$(date +%s)" "$(date +%s)" > "/var/log/script-widget/$1.status"
echo "=== stopped from the dashboard" >> "/var/log/script-widget/$1.log"
`;

// Split "a 'b c' d" into ["a", "b c", "d"]
export function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function createTerminal(command, args, extra = {}) {
  const res = await fetch('/api/v1/terminal/create', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args, readOnly: true, cols: 160, rows: 40, cwd: '/', ...extra }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function deleteTerminal(sessionId) {
  try {
    await fetch(`/api/v1/terminal/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: authHeaders() });
  } catch {
    /* ignore */
  }
}

// Run in the background: setsid detaches the runner from the terminal session, so the
// session ends right away and the script keeps running.
export async function runBackground(script) {
  const s = await createTerminal('setsid', ['-f', 'bash', '-c', RUNNER, 'script-widget', script.id, 'background', script.path, ...splitArgs(script.args)]);
  setTimeout(() => deleteTerminal(s.sessionId), 5000);
}

export async function stopScript(script) {
  const s = await createTerminal('bash', ['-c', STOP, 'script-widget', script.id]);
  setTimeout(() => deleteTerminal(s.sessionId), 5000);
}

// Run with live output. onOutput(text) is called with raw terminal chunks, onExit() at the end.
// Returns a handle with close() (stops following; the script itself keeps running).
export async function runLive(script, { onOutput, onExit, onError }) {
  const session = await createTerminal('bash', ['-c', RUNNER, 'script-widget', script.id, 'live', script.path, ...splitArgs(script.args)]);
  const socket = io('/terminal', { path: '/api/v1/socket.io/', transports: ['websocket', 'polling'] });
  let finished = false;
  socket.on('connect', () => socket.emit('join-session', { sessionId: session.sessionId, token: localStorage.getItem('authToken') }));
  socket.on('terminal-output', (data) => onOutput?.(typeof data === 'string' ? data : data?.data ?? ''));
  socket.on('terminal-exit', () => {
    finished = true;
    onExit?.();
    socket.disconnect();
  });
  socket.on('error', (e) => onError?.(e?.message || String(e)));
  socket.on('connect_error', (e) => onError?.(e?.message || String(e)));
  return {
    close() {
      socket.disconnect();
      if (finished) deleteTerminal(session.sessionId);
    },
  };
}

async function readLogFile(name, lines) {
  const res = await fetch(`/api/v1/system/logs/content?path=${encodeURIComponent(`${LOG_DIR}/${name}`)}&tail=true&lines=${lines}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function readStatus(script) {
  const data = await readLogFile(`${script.id}.status`, 1);
  if (!data) return null;
  const text = Array.isArray(data.content) ? data.content.join('\n') : String(data.content ?? '');
  try {
    return JSON.parse(text.trim().split('\n').pop());
  } catch {
    return null;
  }
}

export async function readLog(script, lines = 2000) {
  const data = await readLogFile(`${script.id}.log`, lines);
  if (!data) return null;
  // /system/logs/content returns the lines as an array (empty lines are dropped)
  return Array.isArray(data.content) ? data.content.join('\n') : String(data.content ?? '');
}

// Terminal output -> plain text: strips ANSI escapes and handles \r (progress bars overwrite the line)
export function terminalToText(prev, chunk) {
  const clean = chunk.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][0-9A-B]/g, '').replace(/\x1b[=>]/g, '');
  let text = prev;
  for (const part of clean.split(/(\r\n|\n|\r)/)) {
    if (part === '\n' || part === '\r\n') text += '\n';
    else if (part === '\r') text = text.slice(0, text.lastIndexOf('\n') + 1);
    else text += part;
  }
  return text.length > 400000 ? text.slice(-300000) : text;
}

export function useScripts() {
  const settings = ref({ ...DEFAULT_SETTINGS, scripts: [] });
  const statuses = ref({});
  const loading = ref(true);

  const refreshStatuses = async () => {
    const results = await Promise.all(settings.value.scripts.map(async (s) => [s.id, await readStatus(s)]));
    statuses.value = Object.fromEntries(results);
  };

  const load = async () => {
    settings.value = await loadSettings();
    await refreshStatuses();
    loading.value = false;
  };

  return { settings, statuses, loading, load, refreshStatuses };
}

export function usePolling(fn, seconds) {
  let timer = null;
  return {
    start(s = seconds) {
      this.stop();
      timer = setInterval(fn, Math.max(2, s) * 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export function ago(ts, t) {
  if (!ts) return '';
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return t('plugin_script_widget.ago_s', { n: s });
  if (s < 3600) return t('plugin_script_widget.ago_m', { n: Math.round(s / 60) });
  if (s < 86400 * 2) return t('plugin_script_widget.ago_h', { n: Math.round(s / 3600) });
  return t('plugin_script_widget.ago_d', { n: Math.round(s / 86400) });
}

export function duration(st) {
  if (!st?.start) return '';
  const s = (st.end || Math.round(Date.now() / 1000)) - st.start;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
