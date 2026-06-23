import SwiftUI
import WidgetKit

/// Minimal host app. macOS requires a containing application to register and
/// install a WidgetKit extension — run it once, then add the widget from the
/// desktop / Notification Center widget gallery.
@main
struct HomeWizardWidgetApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 14) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(
                        LinearGradient(colors: [Color(red: 0.49, green: 0.89, blue: 0.58),
                                                Color(red: 0.17, green: 0.77, blue: 0.77)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
                Text("HomeWizard Widget").font(.title2).bold()
                Text("Le widget est installé.\nAjoute-le depuis le bureau (clic droit → Modifier les widgets)\nou le Centre de notifications.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Text("Assure-toi que l'app HomeWizard Monitor tourne :\nle widget lit son fichier latest.json.")
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.tertiary)
            }
            .padding(40)
            .frame(width: 420, height: 300)
            .onAppear { WidgetCenter.shared.reloadAllTimelines() }
        }
        .windowResizability(.contentSize)
    }
}
