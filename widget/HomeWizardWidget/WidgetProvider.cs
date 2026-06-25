// HomeWizard Widget — IWidgetProvider implementation.
// Reads the Electron app's latest.json and renders an Adaptive Card.
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Windows.Widgets.Providers;

namespace HomeWizardWidget;

[ComVisible(true)]
[ComDefaultInterface(typeof(IWidgetProvider))]
[Guid("9C2D6E4A-1F3B-4D7C-A5E8-6B0C2D4F8A19")]
public sealed class WidgetProvider : IWidgetProvider
{
    private const string DefinitionId = "HomeWizard_Overview";

    // Active widget ids (pinned + currently listening for updates).
    private static readonly HashSet<string> ActiveWidgets = new();
    private static readonly object Gate = new();
    private static readonly ManualResetEvent EmptyWidgetListEvent = new(false);
    private static Timer? _timer;

    public static ManualResetEvent GetEmptyWidgetListEvent() => EmptyWidgetListEvent;

    public WidgetProvider()
    {
        // Recover widgets already pinned across provider restarts.
        try
        {
            var mgr = WidgetManager.GetDefault();
            foreach (var info in mgr.GetWidgetInfos() ?? Array.Empty<WidgetInfo>())
            {
                lock (Gate) ActiveWidgets.Add(info.WidgetContext.Id);
            }
        }
        catch { /* ignore */ }
        EnsureTimer();
    }

    public void CreateWidget(WidgetContext widgetContext)
    {
        lock (Gate) ActiveWidgets.Add(widgetContext.Id);
        EmptyWidgetListEvent.Reset();
        PushUpdate(widgetContext.Id);
        EnsureTimer();
    }

    public void DeleteWidget(string widgetId, string customState)
    {
        lock (Gate)
        {
            ActiveWidgets.Remove(widgetId);
            if (ActiveWidgets.Count == 0) EmptyWidgetListEvent.Set();
        }
    }

    public void OnActionInvoked(WidgetActionInvokedArgs args)
    {
        // "refresh" verb (or any action) → push fresh data.
        PushUpdate(args.WidgetContext.Id);
    }

    public void OnWidgetContextChanged(WidgetContextChangedArgs args)
    {
        PushUpdate(args.WidgetContext.Id);
    }

    public void Activate(WidgetContext widgetContext)
    {
        lock (Gate) ActiveWidgets.Add(widgetContext.Id);
        PushUpdate(widgetContext.Id);
        EnsureTimer();
    }

    public void Deactivate(string widgetId)
    {
        // Keep tracking the widget but it's not visible; the timer still runs cheaply.
    }

    // ---- Update plumbing ----
    private static void EnsureTimer()
    {
        _timer ??= new Timer(_ =>
        {
            string[] ids;
            lock (Gate) ids = ActiveWidgets.ToArray();
            foreach (var id in ids) PushUpdate(id);
        }, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
    }

    private static void PushUpdate(string widgetId)
    {
        try
        {
            var options = new WidgetUpdateRequestOptions(widgetId)
            {
                Template = Template,
                Data = BuildData(),
            };
            WidgetManager.GetDefault().UpdateWidget(options);
        }
        catch { /* host may be transiently unavailable */ }
    }

    // ---- Data from the Electron app's latest.json ----
    private static string LatestJsonPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "AppData", "Roaming", "homewizard-monitor", "latest.json");

    // ---- Localisation (en / fr / nl) ----
    private static readonly Dictionary<string, Dictionary<string, string>> L = new()
    {
        ["en"] = new() { ["battery"] = "Battery", ["grid"] = "Grid", ["solar"] = "Solar", ["gas"] = "Gas", ["updated"] = "Updated", ["refresh"] = "Refresh", ["unavailable"] = "data unavailable" },
        ["fr"] = new() { ["battery"] = "Batterie", ["grid"] = "Réseau", ["solar"] = "Solaire", ["gas"] = "Gaz", ["updated"] = "Maj", ["refresh"] = "Rafraîchir", ["unavailable"] = "données indisponibles" },
        ["nl"] = new() { ["battery"] = "Accu", ["grid"] = "Net", ["solar"] = "Zon", ["gas"] = "Gas", ["updated"] = "Bijgewerkt", ["refresh"] = "Vernieuwen", ["unavailable"] = "gegevens niet beschikbaar" },
    };
    private static string T(string key, string loc) =>
        (L.TryGetValue(loc, out var d) && d.TryGetValue(key, out var v)) ? v : L["en"][key];
    private static string SysLocale()
    {
        var l = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.ToLowerInvariant();
        return (l == "fr" || l == "nl") ? l : "en";
    }

    private static string BuildData()
    {
        string battery = "—", grid = "—", solar = "—", gas = "—", updated = "";
        string locale = SysLocale();
        try
        {
            var json = File.ReadAllText(LatestJsonPath);
            var root = JsonNode.Parse(json)!.AsObject();
            var jl = root["locale"]?.GetValue<string>();
            if (!string.IsNullOrEmpty(jl)) locale = jl!.Length >= 2 ? jl.Substring(0, 2).ToLowerInvariant() : jl;
            updated = FormatTime(root["updatedAt"]?.GetValue<string>());
            foreach (var d in root["devices"]!.AsArray())
            {
                var o = d!.AsObject();
                var kind = o["kind"]?.GetValue<string>();
                var role = o["role"]?.GetValue<string>();
                bool online = o["online"]?.GetValue<bool>() ?? false;
                double? p = o["powerW"]?.GetValue<double?>();
                if (!online) continue;
                if (kind is "battery" or "batteries")
                {
                    double? soc = o["socPct"]?.GetValue<double?>();
                    // % en priorité (l'info la plus importante), puissance en complément.
                    battery = soc.HasValue
                        ? $"{Math.Round(soc.Value)} % · {FmtW(p)}"
                        : FmtW(p);
                }
                else if (role == "grid") grid = FmtW(p);
                else if (role is "solar" or "energy") solar = FmtW(p);
                else if (kind == "gas")
                {
                    var g = o["gasM3"]?.GetValue<double?>();
                    gas = g.HasValue ? g.Value.ToString("0.##") + " m³" : "—";
                }
            }
        }
        catch
        {
            updated = T("unavailable", locale);
        }

        var data = new JsonObject
        {
            ["battery"] = battery,
            ["grid"] = grid,
            ["solar"] = solar,
            ["gas"] = gas,
            ["updated"] = updated,
            ["l_battery"] = T("battery", locale),
            ["l_grid"] = T("grid", locale),
            ["l_solar"] = T("solar", locale),
            ["l_gas"] = T("gas", locale),
            ["l_updated"] = T("updated", locale),
            ["l_refresh"] = T("refresh", locale),
        };
        return data.ToJsonString();
    }

    private static string FmtW(double? w)
    {
        if (w is null) return "—";
        double a = Math.Abs(w.Value);
        return a >= 1000 ? (w.Value / 1000).ToString("0.0") + " kW" : Math.Round(w.Value) + " W";
    }

    private static string FormatTime(string? iso)
    {
        if (DateTime.TryParse(iso, out var t)) return t.ToLocalTime().ToString("HH:mm:ss");
        return "";
    }

    // ---- Adaptive Card template (embedded; ${...} bind to BuildData) ----
    private const string Template = """
    {
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "type": "AdaptiveCard",
      "version": "1.5",
      "body": [
        { "type": "TextBlock", "text": "⚡ HomeWizard", "weight": "bolder", "size": "medium", "spacing": "none" },
        { "type": "FactSet", "spacing": "small", "facts": [
          { "title": "${l_battery}", "value": "${battery}" },
          { "title": "${l_grid}", "value": "${grid}" },
          { "title": "${l_solar}", "value": "${solar}", "$when": "${$host.widgetSize != \"small\"}" },
          { "title": "${l_gas}", "value": "${gas}", "$when": "${$host.widgetSize != \"small\"}" }
        ]},
        { "type": "TextBlock", "text": "${l_updated} ${updated}", "isSubtle": true, "size": "small", "spacing": "small", "wrap": true }
      ],
      "actions": [ { "type": "Action.Execute", "title": "${l_refresh}", "verb": "refresh" } ]
    }
    """;
}
