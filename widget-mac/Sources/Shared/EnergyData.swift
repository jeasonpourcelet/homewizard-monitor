import Foundation

/// Snapshot decoded from the Electron app's `latest.json`.
/// The file is written by HomeWizard Monitor to
/// `~/Library/Application Support/homewizard-monitor/latest.json`.
struct EnergySnapshot {
    var updatedAt: Date?
    var batterySoc: Double?     // %
    var batteryPower: Double?   // W (signed; <0 = charging convention varies)
    var gridPower: Double?      // W
    var solarPower: Double?     // W
    var gasM3: Double?          // m³
    var anyOnline: Bool

    static let placeholder = EnergySnapshot(
        updatedAt: nil, batterySoc: 87, batteryPower: -350,
        gridPower: 120, solarPower: 640, gasM3: 1234.56, anyOnline: true)
}

/// Reads + parses latest.json. No third-party deps; tolerant of missing fields.
enum EnergyLoader {

    /// Absolute path to latest.json, resolved against the *real* home directory
    /// (getpwuid bypasses the sandbox's redirected HOME so the temporary-exception
    /// entitlement can read the Electron app's support folder).
    static var latestJSONPath: String {
        let home: String
        if let pw = getpwuid(getuid()) {
            home = String(cString: pw.pointee.pw_dir)
        } else {
            home = NSHomeDirectory()
        }
        return home + "/Library/Application Support/homewizard-monitor/latest.json"
    }

    static func load() -> EnergySnapshot? {
        let path = latestJSONPath
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        var snap = EnergySnapshot(updatedAt: nil, batterySoc: nil, batteryPower: nil,
                                  gridPower: nil, solarPower: nil, gasM3: nil, anyOnline: false)

        if let ts = root["updatedAt"] as? String {
            snap.updatedAt = ISO8601DateFormatter().date(from: ts)
        }

        let devices = (root["devices"] as? [[String: Any]]) ?? []
        for d in devices {
            let kind = d["kind"] as? String
            let role = d["role"] as? String
            let online = (d["online"] as? Bool) ?? false
            if online { snap.anyOnline = true }
            let power = (d["powerW"] as? NSNumber)?.doubleValue

            if kind == "battery" || kind == "batteries" {
                snap.batterySoc = (d["socPct"] as? NSNumber)?.doubleValue
                snap.batteryPower = power
            } else if role == "grid" {
                snap.gridPower = power
            } else if role == "solar" || role == "energy" {
                snap.solarPower = power
            } else if kind == "gas" {
                snap.gasM3 = (d["gasM3"] as? NSNumber)?.doubleValue
            }
        }
        return snap
    }
}

/// Display formatting helpers shared by the widget views.
enum Fmt {
    static func watts(_ w: Double?) -> String {
        guard let w = w else { return "—" }
        if abs(w) >= 1000 { return String(format: "%.1f kW", w / 1000) }
        return "\(Int(w.rounded())) W"
    }
    static func soc(_ p: Double?) -> String {
        guard let p = p else { return "—" }
        return "\(Int(p.rounded())) %"
    }
    static func gas(_ m3: Double?) -> String {
        guard let m3 = m3 else { return "—" }
        return String(format: "%.2f m³", m3)
    }
    static func time(_ d: Date?) -> String {
        guard let d = d else { return "—" }
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}
