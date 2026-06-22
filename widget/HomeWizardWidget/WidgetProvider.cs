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

    private static string BuildData()
    {
        string battery = "—", grid = "—", solar = "—", gas = "—", updated = "";
        try
        {
            var json = File.ReadAllText(LatestJsonPath);
            var root = JsonNode.Parse(json)!.AsObject();
            updated = FormatTime(root["updatedAt"]?.GetValue<string>());
            foreach (var d in root["devices"]!.AsArray())
            {
                var o = d!.AsObject();
                var kind = o["kind"]?.GetValue<string>();
                var role = o["role"]?.GetValue<string>();
                bool online = o["online"]?.GetValue<bool>() ?? false;
                double? p = o["powerW"]?.GetValue<double?>();
                if (!online) continue;
                if (kind is "batteries" or "battery") battery = FmtW(p);
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
            updated = "données indisponibles";
        }

        var data = new JsonObject
        {
            ["battery"] = battery,
            ["grid"] = grid,
            ["solar"] = solar,
            ["gas"] = gas,
            ["updated"] = updated,
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
          { "title": "Batterie", "value": "${battery}" },
          { "title": "Grille", "value": "${grid}" },
          { "title": "Solaire", "value": "${solar}", "$when": "${$host.widgetSize != \"small\"}" },
          { "title": "Gaz", "value": "${gas}", "$when": "${$host.widgetSize != \"small\"}" }
        ]},
        { "type": "TextBlock", "text": "Maj ${updated}", "isSubtle": true, "size": "small", "spacing": "small", "wrap": true }
      ],
      "actions": [ { "type": "Action.Execute", "title": "Rafraîchir", "verb": "refresh" } ]
    }
    """;
}
