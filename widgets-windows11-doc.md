# Créer un widget Windows 11 (board Widgets)

> Note de contexte : sur cette machine, les Widgets étaient bloqués par une clé de registre locale
> `HKLM\SOFTWARE\Policies\Microsoft\Dsh\AllowNewsAndInterests = 0` (posée par un outil de "debloat",
> pas une vraie GPO d'entreprise). Pour débloquer, en PowerShell **admin** :
> ```powershell
> Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Dsh' -Name 'AllowNewsAndInterests'
> Stop-Process -Name explorer -Force
> ```

## Le concept clé

Un widget Windows 11 n'est **pas** une fenêtre que tu dessines toi-même. C'est un **conteneur piloté
par le système** : ton app fournit un *widget provider* qui renvoie au « Widgets host » deux choses en JSON :

1. un **template visuel** au format **Adaptive Cards** (le rendu, identique partout)
2. les **données** qui le remplissent (liaison dynamique data ↔ template)

Windows s'occupe du rendu, du cycle de vie, du rafraîchissement. Toi tu réponds aux requêtes.

> « Barre des tâches » au sens strict = la zone des boutons. Les widgets, eux, vivent dans le
> **board Widgets** (l'icône à gauche de la barre des tâches). On ne peut pas épingler un widget tiers
> *directement dans* la barre des tâches elle-même — c'est le board qui les héberge.

## Les 2 chemins possibles

| Chemin | Pour qui | Techno |
|--------|----------|--------|
| **App Win32 packagée** | App native | C# ou C++/WinRT, implémente `IWidgetProvider` |
| **PWA** | App web | Manifest PWA + Service Worker, Adaptive Cards |

Pour le projet **HomeWizard Monitor** (Electron, techno web) : Electron n'est pas une vraie PWA.
En pratique → soit créer un petit provider **C# packagé** à côté, soit exposer une vraie **PWA**.

## Les pièces à assembler (chemin C# packagé)

1. **`IWidgetProvider`** — gère le cycle de vie : `CreateWidget`, `DeleteWidget`, `OnActionInvoked`,
   `Activate`/`Deactivate`. C'est lui qui renvoie le template + les données.
2. **Enregistrement dans le `Package.appxmanifest`** via une `AppExtension` de catégorie
   `com.microsoft.windows.widgets` qui pointe vers un fichier de définition.
3. **Définition du widget (JSON)** — déclare : id, nom affiché, description, **tailles** supportées
   (`small`/`medium`/`large`), **icônes** et **screenshots** (l'aperçu dans le sélecteur
   « + Ajouter un widget »).
4. **Le COM server** — l'app packagée s'enregistre comme serveur COM activable que le host appelle.

## Prérequis

- **Windows App SDK 1.2 ou +**
- Le board Widgets à jour
- App **packagée** (MSIX) — un .exe nu ne suffit pas, il faut le packaging pour l'`AppExtension`

## La doc officielle (à suivre dans l'ordre)

- Vue d'ensemble providers : https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-providers
- Implémenter en C# (le plus pédagogique) : https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-cs
- Implémenter en C++/WinRT : https://learn.microsoft.com/en-us/windows/apps/develop/widgets/implement-widget-provider-win32
- Chemin PWA : https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps-chromium/how-to/widgets
- Exemple complet de code (C# + C++) : https://github.com/microsoft/WindowsAppSDK-Samples/blob/main/Samples/Widgets/README.md
- Référence API : https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.windows.widgets.providers
- Design / Adaptive Cards : https://learn.microsoft.com/en-us/windows/apps/design/widgets/ et https://adaptivecards.io
