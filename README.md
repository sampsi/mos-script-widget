# MOS Script Widget

Dashboard widget for [MOS](https://github.com/ich777) that runs your own shell scripts, a bit like
Unraid's *User Scripts*, but right on the dashboard.

- **Settings page**: add scripts by path (e.g. `/mnt/data/run.sh`), optional arguments, icon
  (`mdi-…`), "ask for confirmation" and "show in widget". *Run with log* button for testing.
- **Widget**: one row per script with its latest result (OK / error + exit code, when, how long) and
  buttons:
  - ▶ **Run in background**: keeps running when you leave the page.
  - **Run with log**: live output in a dialog (ANSI codes stripped, `\r` progress bars handled).
    Closing the dialog does not stop the script.
  - **Show latest log** and **Stop** (kills the whole process group) while it runs.

Scripts run as root through the MOS terminal API (admin account required). Non-executable files are
run with `bash`. The path and arguments are passed as separate arguments, never interpolated into a
shell string. Latest log and status per script: `/var/log/script-widget/<id>.log|.status` (also
visible in the MOS log viewer; `/var/log` is in RAM, so they are gone after a reboot).

Uses only the MOS API: plugin settings (`/api/v1/mos/plugins/settings/script-widget`),
`/api/v1/terminal/create` + socket.io namespace `/terminal`, and `/api/v1/system/logs/content`.

## Build

```bash
cd page && npm install && npm run build   # -> page/dist/script-widget
```

A tag push (e.g. `0.1.0`) builds `script-widget-<tag>-1+mos-plugin_all.deb` with GitHub Actions.
