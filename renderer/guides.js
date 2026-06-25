'use strict';
// Localised onboarding Guide (rich HTML) injected into #guide by app.js.
// The #widget-mac-panel block stays here (shown on macOS by app.js).
window.GUIDES = {
  en: `
    <div class="guide-intro panel">
      <h2>👋 Welcome</h2>
      <p>HomeWizard Monitor reads your HomeWizard devices <b>directly on your local network</b>
      (Wi-Fi or Ethernet). No account, no cloud — all your data stays with you.</p>
      <p class="muted small">Follow the steps below. The first setup takes about 5 minutes.</p>
    </div>
    <div class="step panel"><div class="step-no">1</div><div class="step-body">
      <h3>Network requirements</h3>
      <p>Your computer and your HomeWizard devices must be on <b>the same network</b>.</p>
      <ul><li>If your devices sit behind a <b>secondary router</b>, connect the computer's Wi-Fi to that router (you can keep Ethernet alongside).</li></ul>
    </div></div>
    <div class="step panel"><div class="step-no">2</div><div class="step-body">
      <h3>Enable the "Local API" (HomeWizard phone app)</h3>
      <p>For <b>each</b> device (P1, battery, kWh meter, water):</p>
      <ol><li><b>HomeWizard Energy</b> app → ⚙ Settings → <b>Meters / Devices</b>.</li>
      <li>Select the device → enable <b>"Local API"</b>.</li></ol>
      <div class="callout warn">⚠️ <b>Battery & recent meters</b>: on the same page, turn <b>off</b> "Disable pairing button". Otherwise the button won't respond when pairing. <span class="muted">(Tip: rebooting the device temporarily re-enables the button.)</span></div>
    </div></div>
    <div class="step panel"><div class="step-no">3</div><div class="step-body">
      <h3>Add your devices</h3>
      <p><b>🔌 Devices</b> tab:</p>
      <ul><li><b>🔍 Discover</b>: scans your network (~30 s) and lists the devices found.</li>
      <li>Or <b>Add by IP</b>: the IP is shown in the HomeWizard app ("Local API" section of each device).</li>
      <li>Click <b>💾 Save</b>.</li></ul>
    </div></div>
    <div class="step panel"><div class="step-no">4</div><div class="step-body">
      <h3>Pair the battery & recent kWh meters</h3>
      <p>These devices need a security token (a "🔗 Pair" button shows on their card):</p>
      <ol><li>Devices tab → click <b>🔗 Pair</b> on the device. <b>The 30 s window starts.</b></li>
      <li><b>During those 30 s</b>, press the device's <b>physical button</b> (short press, 1–2 s).</li></ol>
      <div class="callout">💡 <b>Order matters</b>: click "Pair" <b>first</b>, press the button <b>after</b>. If nothing happens, recheck step 2 (Local API on + pairing button not disabled).</div>
    </div></div>
    <div class="step panel"><div class="step-no">5</div><div class="step-body">
      <h3>Customise</h3>
      <ul><li>Devices tab → <b>Menu-bar indicator</b>: choose the value shown on the icon (e.g. <b>battery %</b>).</li>
      <li>The app lives in the menu bar: <b>click</b> = open, <b>right-click</b> = menu (Refresh, "Open at login", Quit).</li></ul>
    </div></div>
    <div id="widget-mac-panel" class="panel" hidden>
      <h3>🧩 Desktop widget (macOS)</h3>
      <p>Shows your values (battery, grid, solar, gas) right on the <b>desktop</b> or in <b>Notification Center</b>, like a native widget.</p>
      <div class="callout">ℹ️ The widget is a small <b>separate</b> native app ("Home Wizard") — macOS requires it (a widget can't live inside this app). They <b>communicate</b>: HomeWizard Monitor must be running for the widget to show data. <b>Clicking the widget opens HomeWizard Monitor.</b></div>
      <ol><li>Click <b>"Activate / refresh widget"</b> below (registers the widget).</li>
      <li><b>Right-click the desktop → Edit Widgets…</b></li>
      <li>Find <b>"Home Wizard"</b> → drag a tile onto the desktop.</li></ol>
      <button id="btn-widget-activate" class="secondary">🧩 Activate / refresh widget</button>
      <p id="widget-activate-status" class="muted small"></p>
    </div>
    <div class="panel">
      <h3>🛠️ Troubleshooting</h3>
      <ul><li><b>"No device found"</b>: auto-discovery doesn't cross some routers. Use <b>Add by IP</b>.</li>
      <li><b>Device "offline"</b>: check Wi-Fi and that the Local API is on. The water meter is battery-powered and reports only intermittently (normal).</li>
      <li><b>Changing IP</b>: the app re-finds the device by serial. For stability, reserve its IP in your router (DHCP).</li>
      <li><b>🧬 Data</b> tab: shows every raw field per device (useful for diagnostics).</li></ul>
    </div>`,

  fr: `
    <div class="guide-intro panel">
      <h2>👋 Bienvenue</h2>
      <p>HomeWizard Monitor lit vos appareils HomeWizard <b>directement sur votre réseau local</b>
      (Wi-Fi ou Ethernet). Aucun compte, aucun cloud : toutes vos données restent chez vous.</p>
      <p class="muted small">Suivez les étapes ci-dessous. Comptez 5 minutes pour la première configuration.</p>
    </div>
    <div class="step panel"><div class="step-no">1</div><div class="step-body">
      <h3>Prérequis réseau</h3>
      <p>Votre PC et vos appareils HomeWizard doivent être sur <b>le même réseau</b>.</p>
      <ul><li>Si vos appareils sont derrière un <b>routeur secondaire</b>, connectez le Wi-Fi du PC à ce routeur (vous pouvez garder l'Ethernet en parallèle).</li></ul>
    </div></div>
    <div class="step panel"><div class="step-no">2</div><div class="step-body">
      <h3>Activer l'« API locale » (app HomeWizard sur téléphone)</h3>
      <p>Pour <b>chaque</b> appareil (P1, batterie, compteur kWh, eau) :</p>
      <ol><li>App <b>HomeWizard Energy</b> → ⚙ Réglages → <b>Compteurs / Appareils</b>.</li>
      <li>Sélectionnez l'appareil → activez <b>« API locale »</b>.</li></ol>
      <div class="callout warn">⚠️ <b>Batterie & compteurs récents</b> : dans la même page, désactivez l'option <b>« Désactiver le bouton d'appairage »</b>. Sinon le bouton ne répondra pas lors de l'appairage. <span class="muted">(Astuce : redémarrer l'appareil réactive temporairement le bouton.)</span></div>
    </div></div>
    <div class="step panel"><div class="step-no">3</div><div class="step-body">
      <h3>Ajouter vos appareils</h3>
      <p>Onglet <b>🔌 Appareils</b> :</p>
      <ul><li><b>🔍 Découvrir</b> : scanne votre réseau (~30 s) et liste les appareils trouvés.</li>
      <li>Ou <b>Ajouter par IP</b> : l'adresse IP est indiquée dans l'app HomeWizard (section « API locale » de chaque appareil).</li>
      <li>Cliquez <b>💾 Enregistrer</b>.</li></ul>
    </div></div>
    <div class="step panel"><div class="step-no">4</div><div class="step-body">
      <h3>Appairer la batterie & les compteurs kWh récents</h3>
      <p>Ces appareils exigent un jeton de sécurité (bouton « 🔗 Appairer » visible sur leur carte) :</p>
      <ol><li>Onglet Appareils → cliquez <b>🔗 Appairer</b> sur l'appareil. <b>La fenêtre de 30 s démarre.</b></li>
      <li><b>Pendant ces 30 s</b>, allez presser le <b>bouton physique</b> de l'appareil (appui court, 1-2 s).</li></ol>
      <div class="callout">💡 <b>L'ordre est crucial</b> : cliquez « Appairer » <b>d'abord</b>, pressez le bouton <b>ensuite</b>. Si rien ne se passe, revérifiez l'étape 2 (API locale activée + bouton d'appairage non désactivé).</div>
    </div></div>
    <div class="step panel"><div class="step-no">5</div><div class="step-body">
      <h3>Personnaliser</h3>
      <ul><li>Onglet Appareils → <b>Indicateur barre des tâches</b> : choisissez la valeur affichée sur l'icône (ex. <b>% batterie</b>).</li>
      <li>L'app vit dans la barre des tâches : <b>clic</b> = ouvrir, <b>clic droit</b> = menu (Actualiser, « Ouvrir au démarrage », Quitter).</li></ul>
    </div></div>
    <div id="widget-mac-panel" class="panel" hidden>
      <h3>🧩 Widget de bureau (macOS)</h3>
      <p>Affiche vos valeurs (batterie, réseau, solaire, gaz) directement sur le <b>bureau</b> ou le <b>Centre de notifications</b>, comme un widget natif.</p>
      <div class="callout">ℹ️ Le widget est une petite app native <b>séparée</b> (« Home Wizard ») — macOS l'exige (un widget ne peut pas vivre dans cette app). Les deux <b>communiquent</b> : HomeWizard Monitor doit tourner pour que le widget affiche des données. <b>Cliquer le widget ouvre HomeWizard Monitor.</b></div>
      <ol><li>Cliquez <b>« Activer / rafraîchir le widget »</b> ci-dessous (enregistre le widget).</li>
      <li><b>Clic droit sur le bureau → Modifier les widgets…</b></li>
      <li>Cherchez <b>« Home Wizard »</b> → glissez une tuile sur le bureau.</li></ol>
      <button id="btn-widget-activate" class="secondary">🧩 Activer / rafraîchir le widget</button>
      <p id="widget-activate-status" class="muted small"></p>
    </div>
    <div class="panel">
      <h3>🛠️ Dépannage</h3>
      <ul><li><b>« Aucun appareil trouvé »</b> : la découverte automatique ne traverse pas certains routeurs. Utilisez <b>Ajouter par IP</b>.</li>
      <li><b>Appareil « hors ligne »</b> : vérifiez le Wi-Fi et que l'API locale est activée. Le compteur d'eau est sur batterie et ne répond que par intermittence (normal).</li>
      <li><b>IP qui change</b> : l'app retrouve l'appareil par numéro de série. Pour plus de stabilité, réservez son IP dans votre routeur (DHCP).</li>
      <li>Onglet <b>🧬 Données</b> : affiche tous les champs bruts de chaque appareil (utile pour diagnostiquer).</li></ul>
    </div>`,

  nl: `
    <div class="guide-intro panel">
      <h2>👋 Welkom</h2>
      <p>HomeWizard Monitor leest je HomeWizard-apparaten <b>rechtstreeks op je lokale netwerk</b>
      (wifi of ethernet). Geen account, geen cloud — al je gegevens blijven bij jou.</p>
      <p class="muted small">Volg de stappen hieronder. De eerste configuratie duurt ongeveer 5 minuten.</p>
    </div>
    <div class="step panel"><div class="step-no">1</div><div class="step-body">
      <h3>Netwerkvereisten</h3>
      <p>Je computer en je HomeWizard-apparaten moeten op <b>hetzelfde netwerk</b> zitten.</p>
      <ul><li>Staan je apparaten achter een <b>tweede router</b>? Verbind de wifi van de computer met die router (ethernet mag ernaast blijven).</li></ul>
    </div></div>
    <div class="step panel"><div class="step-no">2</div><div class="step-body">
      <h3>Schakel de "Lokale API" in (HomeWizard-app op telefoon)</h3>
      <p>Voor <b>elk</b> apparaat (P1, accu, kWh-meter, water):</p>
      <ol><li><b>HomeWizard Energy</b>-app → ⚙ Instellingen → <b>Meters / Apparaten</b>.</li>
      <li>Kies het apparaat → schakel <b>"Lokale API"</b> in.</li></ol>
      <div class="callout warn">⚠️ <b>Accu & recente meters</b>: zet op dezelfde pagina "Koppelknop uitschakelen" <b>uit</b>. Anders reageert de knop niet bij het koppelen. <span class="muted">(Tip: het apparaat herstarten activeert de knop tijdelijk weer.)</span></div>
    </div></div>
    <div class="step panel"><div class="step-no">3</div><div class="step-body">
      <h3>Apparaten toevoegen</h3>
      <p>Tabblad <b>🔌 Apparaten</b>:</p>
      <ul><li><b>🔍 Zoeken</b>: scant je netwerk (~30 s) en toont de gevonden apparaten.</li>
      <li>Of <b>Toevoegen via IP</b>: het IP staat in de HomeWizard-app (sectie "Lokale API" van elk apparaat).</li>
      <li>Klik op <b>💾 Opslaan</b>.</li></ul>
    </div></div>
    <div class="step panel"><div class="step-no">4</div><div class="step-body">
      <h3>Koppel de accu & recente kWh-meters</h3>
      <p>Deze apparaten hebben een beveiligingstoken nodig (knop "🔗 Koppelen" op hun kaart):</p>
      <ol><li>Tabblad Apparaten → klik op <b>🔗 Koppelen</b> bij het apparaat. <b>Het venster van 30 s start.</b></li>
      <li><b>Binnen die 30 s</b> druk je op de <b>fysieke knop</b> van het apparaat (korte druk, 1–2 s).</li></ol>
      <div class="callout">💡 <b>De volgorde is cruciaal</b>: klik <b>eerst</b> op "Koppelen", druk <b>daarna</b> op de knop. Gebeurt er niets, controleer stap 2 (Lokale API aan + koppelknop niet uitgeschakeld).</div>
    </div></div>
    <div class="step panel"><div class="step-no">5</div><div class="step-body">
      <h3>Aanpassen</h3>
      <ul><li>Tabblad Apparaten → <b>Menubalk-indicator</b>: kies de waarde op het icoon (bijv. <b>accu %</b>).</li>
      <li>De app leeft in de menubalk: <b>klik</b> = openen, <b>rechtsklik</b> = menu (Vernieuwen, "Openen bij inloggen", Afsluiten).</li></ul>
    </div></div>
    <div id="widget-mac-panel" class="panel" hidden>
      <h3>🧩 Bureaublad-widget (macOS)</h3>
      <p>Toont je waarden (accu, net, zon, gas) direct op het <b>bureaublad</b> of in het <b>Berichtencentrum</b>, als een native widget.</p>
      <div class="callout">ℹ️ De widget is een kleine <b>aparte</b> native app ("Home Wizard") — macOS vereist dit (een widget kan niet in deze app leven). Ze <b>communiceren</b>: HomeWizard Monitor moet draaien zodat de widget gegevens toont. <b>Op de widget klikken opent HomeWizard Monitor.</b></div>
      <ol><li>Klik hieronder op <b>"Widget activeren / vernieuwen"</b> (registreert de widget).</li>
      <li><b>Rechtsklik op het bureaublad → Widgets bewerken…</b></li>
      <li>Zoek <b>"Home Wizard"</b> → sleep een tegel op het bureaublad.</li></ol>
      <button id="btn-widget-activate" class="secondary">🧩 Widget activeren / vernieuwen</button>
      <p id="widget-activate-status" class="muted small"></p>
    </div>
    <div class="panel">
      <h3>🛠️ Problemen oplossen</h3>
      <ul><li><b>"Geen apparaat gevonden"</b>: automatisch zoeken werkt niet over sommige routers. Gebruik <b>Toevoegen via IP</b>.</li>
      <li><b>Apparaat "offline"</b>: controleer wifi en of de Lokale API aan staat. De watermeter werkt op een accu en meldt zich met tussenpozen (normaal).</li>
      <li><b>Veranderend IP</b>: de app vindt het apparaat terug via serienummer. Reserveer voor stabiliteit het IP in je router (DHCP).</li>
      <li>Tabblad <b>🧬 Gegevens</b>: toont alle ruwe velden per apparaat (handig om te diagnosticeren).</li></ul>
    </div>`,
};
