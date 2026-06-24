import SwiftUI
import WidgetKit

/// Invisible host. macOS requires a containing app to register the WidgetKit
/// extension, but it needs no UI — this runs as a background agent (LSUIElement:
/// no window, no Dock icon) and just refreshes the widget when launched. Clicking
/// the widget opens HomeWizard Monitor (via its URL scheme), not this app.
@main
struct HomeWizardWidgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene {
        Settings { EmptyView() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
