# HomeWizard Monitor — macOS desktop widget (WidgetKit)

A native **SwiftUI + WidgetKit** widget for macOS (Sonoma 14+). It shows live
energy metrics — battery %, battery/grid/solar power, gas — on the **desktop**
and in **Notification Center**.

It reads the same data the Windows widget uses: the file the Electron app writes
to `~/Library/Application Support/homewizard-monitor/latest.json`. **HomeWizard
Monitor must be running** for the widget to show fresh values.

> macOS throttles widget refresh, so values are near-live (refreshed roughly
> every few minutes), not the 2-second cadence of the main app.

## Requirements

- **Xcode** (full app, from the Mac App Store) — Command Line Tools alone are not
  enough for WidgetKit.
- macOS 14 (Sonoma) or newer for desktop widgets.

## Quick (re)install — one command

```bash
brew install xcodegen        # once
bash widget-mac/install.sh   # build + install + register the widget
```
Then add the tile: right-click the desktop → **Edit Widgets** → **Home Wizard**.
Re-run `install.sh` whenever you change the widget code. The steps below explain
the manual routes.

## Build — option A: XcodeGen (recommended)

```bash
brew install xcodegen
cd widget-mac
xcodegen generate          # creates HomeWizardWidget.xcodeproj
open HomeWizardWidget.xcodeproj
```

In Xcode:
1. Select the **HomeWizardWidget** target → **Signing & Capabilities** → pick your
   Team (a free *Personal Team* is fine). Do the same for **HWMWidgetExtension**.
2. Run the **HomeWizardWidget** app once (▶). A small window confirms install.
3. Add the widget: right-click the desktop → **Edit Widgets**, or open Notification
   Center → **Edit Widgets**, find **HomeWizard**, drag a Small or Medium one out.

## Build — option B: plain Xcode (no XcodeGen)

1. **File → New → Project → macOS → App** named `HomeWizardWidget`, SwiftUI.
2. **File → New → Target → macOS → Widget Extension** named `HWMWidgetExtension`
   (uncheck "Include Configuration Intent").
3. Delete the template Swift files and **add the files** from `Sources/`:
   - `Sources/Shared/EnergyData.swift` → add to **both** targets.
   - `Sources/Widget/HWMWidget.swift` → widget extension target.
   - `Sources/App/HomeWizardWidgetApp.swift` → app target (replace the generated one).
4. On the **widget extension** target → Signing & Capabilities → App Sandbox, then
   open its `.entitlements` and add the temporary-exception key from
   `Sources/Widget/HWMWidget.entitlements` (read-only access to
   `Library/Application Support/homewizard-monitor/`).
5. Set Team for both targets, run the app once, add the widget (step 3 above).

## Why the temporary-exception entitlement?

The widget extension is sandboxed, so by default it can't read the Electron app's
support folder. The entitlement
`com.apple.security.temporary-exception.files.home-relative-path.read-only`
grants read-only access to exactly that folder. This is fine for a personal,
locally-signed build. (For Mac App Store distribution you'd instead share the data
via an **App Group** and have the Electron app mirror `latest.json` into the group
container — not needed here.)

## Files

```
widget-mac/
  project.yml                 # XcodeGen project spec
  Sources/
    Shared/EnergyData.swift    # latest.json model, loader, formatters (both targets)
    App/HomeWizardWidgetApp.swift   # minimal host app
    App/HomeWizardWidget.entitlements
    Widget/HWMWidget.swift     # TimelineProvider + SwiftUI views + WidgetBundle
    Widget/Info.plist          # NSExtension (widgetkit-extension)
    Widget/HWMWidget.entitlements
```
