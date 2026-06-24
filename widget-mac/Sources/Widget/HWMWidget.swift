import WidgetKit
import SwiftUI

// MARK: - Timeline

struct EnergyEntry: TimelineEntry {
    let date: Date
    let snapshot: EnergySnapshot
    let stale: Bool   // true when latest.json couldn't be read / is old
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> EnergyEntry {
        EnergyEntry(date: Date(), snapshot: .placeholder, stale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (EnergyEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EnergyEntry>) -> Void) {
        let entry = makeEntry()
        // Request a fast refresh (~1 min). macOS still throttles widget reloads to
        // a system budget, so this is a best-effort cadence, not a guarantee.
        let next = Calendar.current.date(byAdding: .minute, value: 1, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func makeEntry() -> EnergyEntry {
        if let snap = EnergyLoader.load() {
            let stale: Bool = {
                guard let u = snap.updatedAt else { return false }
                return Date().timeIntervalSince(u) > 600 // >10 min old
            }()
            return EnergyEntry(date: Date(), snapshot: snap, stale: stale || !snap.anyOnline)
        }
        // No file → the desktop app isn't running.
        return EnergyEntry(date: Date(), snapshot: .placeholder, stale: true)
    }
}

// MARK: - Brand

private let brandTop = Color(red: 0.49, green: 0.89, blue: 0.58)   // green
private let brandBottom = Color(red: 0.17, green: 0.77, blue: 0.77) // teal
private let brandGradient = LinearGradient(
    colors: [brandTop, brandBottom], startPoint: .topLeading, endPoint: .bottomTrailing)

// MARK: - Views

struct HWMWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: EnergyEntry

    // Tapping the widget opens HomeWizard Monitor (the Electron app) via its URL scheme.
    var body: some View {
        content.widgetURL(URL(string: "homewizardmonitor://open"))
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .systemSmall: small
        default: medium
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image("Logo").resizable().scaledToFit()
                .frame(width: 16, height: 16)
                .padding(3)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 6))
            Text("Home Wizard").font(.caption).bold().foregroundStyle(.primary)
            Spacer()
            if entry.stale {
                Image(systemName: "wifi.slash").font(.caption2).foregroundStyle(.orange)
            }
        }
    }

    // Small: battery as the hero metric.
    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Spacer(minLength: 0)
            Text(Fmt.soc(entry.snapshot.batterySoc))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(brandGradient)
            Text("Batterie · \(Fmt.watts(entry.snapshot.batteryPower))")
                .font(.caption2).foregroundStyle(.secondary)
            Text("MàJ \(Fmt.time(entry.snapshot.updatedAt))")
                .font(.system(size: 9)).foregroundStyle(.tertiary)
        }
        .padding(12)
        .containerBackground(.background, for: .widget)
    }

    // Medium: four metrics.
    private var medium: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            HStack(spacing: 14) {
                metric("bolt.batteryblock", "Batterie",
                       Fmt.soc(entry.snapshot.batterySoc), Fmt.watts(entry.snapshot.batteryPower))
                metric("powerplug", "Réseau", Fmt.watts(entry.snapshot.gridPower), nil)
            }
            HStack(spacing: 14) {
                metric("sun.max", "Solaire", Fmt.watts(entry.snapshot.solarPower), nil)
                metric("flame", "Gaz", Fmt.gas(entry.snapshot.gasM3), nil)
            }
            Text("Mis à jour à \(Fmt.time(entry.snapshot.updatedAt))")
                .font(.system(size: 9)).foregroundStyle(.tertiary)
        }
        .padding(14)
        .containerBackground(.background, for: .widget)
    }

    private func metric(_ icon: String, _ label: String, _ value: String, _ sub: String?) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(brandGradient).frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
                Text(value).font(.system(size: 15, weight: .semibold, design: .rounded))
                if let sub = sub {
                    Text(sub).font(.system(size: 9)).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Widget

struct HWMWidget: Widget {
    let kind = "HomeWizardWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            HWMWidgetView(entry: entry)
        }
        .configurationDisplayName("Home Wizard")
        .description("Énergie en direct : batterie, réseau, solaire, gaz.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct HWMWidgetBundle: WidgetBundle {
    var body: some Widget { HWMWidget() }
}
