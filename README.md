# HomeWizard Monitor

A lightweight **Windows tray app + dashboard** for [HomeWizard Energy](https://www.homewizard.com/) devices.
Glance at your live power from the taskbar (like a weather widget), click for a full dashboard with
real-time values and live charts — **100% local, no cloud account required**.
Includes a built-in **onboarding guide** so non-technical users can set it up alone.

> The desktop UI is currently in **French**. Contributions to internationalize it are welcome.

---

## ✨ Features

- **Taskbar (tray) icon** — hover for a live tooltip of every device; click to open the dashboard.
- **Real-time dashboard** — HomeWizard-style cards: big value + live area sparkline, with battery
  **state of charge %**, charge/discharge power, grid, solar, water flow, gas.
- **Live charts** — instant consumption per device (the local API keeps no history, so historical
  charts were intentionally dropped to avoid gaps when the app is closed).
- **In-app onboarding Guide** — first-run tab with the exact steps & gotchas (enable Local API,
  the "disable pairing button" trap, pairing sequence, troubleshooting).
- **Raw data tab** — every field returned by each device's API, for diagnostics.
- **Configurable taskbar indicator** — render a chosen value (e.g. battery %) on the tray icon.
- **Auto-discovery** (mDNS + LAN subnet scan) **or** manual IP entry; **DHCP self-healing** by serial.
- **Start with Windows** (tray menu toggle), packaged `.exe`, and a **Windows 11 Widget** (MSIX).
- No telemetry, no cloud calls — talks only to your devices on your LAN.

## 🔌 Supported devices

All HomeWizard Wi-Fi devices that expose the local API:

| Device | Product type | What you get |
| --- | --- | --- |
| P1 Meter | `HWE-P1` | Grid import/export, live power, gas & water (if linked to the meter) |
| Energy Socket | `HWE-SKT` | Power, import/export, on/off state |
| kWh Meter (1-phase) | `HWE-KWH1`, `HWE-KWHA`, `SDM230-wifi` | Power & energy (e.g. solar production) |
| kWh Meter (3-phase) | `HWE-KWH3`, `HWE-KWHB`, `SDM630-wifi` | Power & energy |
| Watermeter | `HWE-WTR` | Total m³ and live flow (battery-powered: reports intermittently) |
| Plug-In Battery | `HWE-BAT` | **State of charge %**, charge/discharge power, cycles (API v2 — enable its Local API + pairing) |

> **Pairing a battery / recent kWh meter (API v2):** enable **Local API** for that device in the
> HomeWizard phone app, and turn **off** *"Disable pairing button"*. Then click **Pair** in the
> Devices tab and press the device's physical button within 30 s. See the in-app **Guide** tab.

> No separate solar meter? Solar still shows up as **grid export** on the P1 card.

## 🧠 How it works

- Polls each device's **local API** every ~2 s:
  - v1 (HTTP, no auth): `GET /api/v1/data` for P1, sockets, kWh meters, watermeter.
  - v2 (HTTPS + Bearer token): `GET /api/measurement` for the Plug-In Battery.
- The local API has **no history**, so "today" / "this month" are computed as the difference between
  each cumulative counter and its value at the start of the period. History therefore builds up from the
  moment you install the app.
- All data is stored locally as JSON under Electron's `userData` folder
  (`%APPDATA%/HomeWizard Monitor/data/` on Windows). Nothing is uploaded anywhere.

## ✅ Requirements

- Windows 10/11 (the tray + autostart + `.exe` packaging target Windows; the code is Electron and could
  be adapted to macOS/Linux).
- [Node.js](https://nodejs.org/) 20+ to run from source or build.
- The PC must be on the **same network** as the HomeWizard devices, and the **Local API** must be enabled
  in the HomeWizard mobile app (per device: *Settings → Meter / Device → Local API*).

## 🚀 Run from source

```bash
git clone https://github.com/jeasonpourcelet/homewizard-monitor.git
cd homewizard-monitor
npm install
npm run icons   # generate tray + app icons
npm start
```

## 📦 Build a Windows .exe

```bash
npm run build   # -> dist/HomeWizard-Monitor-portable.exe + an NSIS installer
```

- **Portable**: `dist/HomeWizard-Monitor-portable.exe` — double-click, no install.
- **Installer**: `dist/HomeWizard Monitor Setup <version>.exe` — desktop + start-menu shortcuts.

<details>
<summary>Build fails on <code>winCodeSign</code> symbolic-link extraction?</summary>

On Windows without Developer Mode / admin, electron-builder can fail extracting `winCodeSign-*.7z`
(it contains macOS symlinks). Pre-extract it once, tolerating the 2 symlink errors, then rebuild:

```powershell
$cache  = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
$target = Join-Path $cache "winCodeSign-2.6.0"
& ".\node_modules\7zip-bin\win\x64\7za.exe" x -snld -bd -y "-o$target" (Get-ChildItem $cache -Filter *.7z)[0].FullName
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run build
```
</details>

## ⚙️ First-time setup

1. Open the dashboard (tray icon) → **⚙**.
2. **Discover on the network**, or add a device **by IP**.
3. Tick the devices → **Save**.

**Pairing a battery (API v2):** tick it, click **🔗 Pair**, then press the physical button on the battery
within 30 s — the app stores the token.

## 🌐 Network notes

- **mDNS discovery doesn't cross routers/subnets.** If your HomeWizard devices sit behind a secondary
  router (their own subnet), put that router in **access-point/bridge mode**, or give the PC a foothold on
  that network (Wi-Fi/cable), then add devices **by IP**.
- On busy/weak 2.4 GHz, a flood scan loses packets — discovery and the built-in rediscovery scan gently in
  batches.
- Set a **DHCP reservation** for each device on your router so IPs stay stable. If an IP does change, the
  app re-finds the device by serial automatically.

## 🔒 Privacy

- **Local-only.** The app communicates solely with your devices over your LAN. No accounts, no cloud, no
  analytics.
- Your device IPs, serial numbers and battery tokens are stored **only** on your machine under `userData`
  and are **not** part of this repository.

## 🗺️ Roadmap

- [x] All HomeWizard local-API device types
- [x] Battery (v2 + pairing), water, gas
- [x] DHCP self-healing by serial
- [x] `.exe` packaging + start-with-Windows
- [ ] Aggregated "home" view (net = grid + solar ± battery)
- [ ] Configurable poll interval & per-device labels in the UI
- [ ] English / i18n

## 🤝 Contributing

Issues and PRs welcome — especially additional device fields, i18n, and macOS/Linux packaging.

## 📄 License

[MIT](LICENSE).

## ⚠️ Disclaimer

Not affiliated with or endorsed by HomeWizard. Uses the publicly documented
[local API](https://api-documentation.homewizard.com/). "HomeWizard" is a trademark of its respective owner.
