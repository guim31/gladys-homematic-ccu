# Homematic CCU

Bringt die Homematic- und Homematic-IP-Geräte deiner **CCU3**, **RaspberryMatic** oder **piVCCU**
lokal in Gladys: Thermostate und Heizkörperthermostate, Fensterkontakte, Bewegungs-, Rauch- und
Wassermelder, Schalter und Steckdosen mit Messung, Rollläden, Dimmer, Wettersensoren, die Tasten
deiner Fernbedienungen, die Systemvariablen und die Programme der CCU.

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Die Integration wurde anhand der
> Dokumentation der CCU, des Codes ihrer Weboberfläche und echter Aufzeichnungen von CCUs aus dem
> Projekt aiohomematic geschrieben, lief aber nie gegen eine echte CCU. Sag uns, was funktioniert
> und was nicht:
> [github.com/guim31/gladys-homematic-ccu/issues](https://github.com/guim31/gladys-homematic-ccu/issues).

Nicht mit eQ-3 verbunden. Homematic und Homematic IP sind Marken der eQ-3 AG.

## Voraussetzungen

- Eine CCU3, eine RaspberryMatic oder eine piVCCU, von Gladys über ihren Webport erreichbar (80,
  oder 443 bei HTTPS). Die Geräte sind wie gewohnt an der CCU angelernt: Gladys ersetzt sie nicht.
- Ein CCU-Benutzer mit **Administratorrechten**: Die Integration liest die Werte mit einem kurzen
  HomeMatic-Skript, das die CCU nur für einen Administrator ausführt. Ist die Authentifizierung
  auf deiner CCU aus (die Voreinstellung), behalte den Benutzer `Admin` und lass das Passwort leer.
- Gladys 5.1 oder neuer.

## Konfiguration

In Gladys, **Integrationen → Homematic CCU → Konfiguration**:

- **Adresse der CCU**: ihre IP-Adresse oder ihr Name, z. B. `192.168.1.50`. Schreib
  `https://192.168.1.50`, wenn die CCU ihre Weboberfläche auf HTTPS umleitet.
- **Benutzer** und **Passwort**: ein Administrator der CCU (`Admin` und ein leeres Passwort, wenn
  die Authentifizierung aus ist).
- **Selbstsigniertes Zertifikat akzeptieren**: standardmäßig an, die CCU signiert ihr
  HTTPS-Zertifikat selbst.
- **Gelesene Schnittstellen**: Homematic IP (Funk), Homematic (Funk), Homematic Wired,
  Heizungsgruppen (Homematic IP). Entferne den Haken bei einer Familie, um sie aus Gladys
  herauszuhalten.
- **Systemvariablen**: die sichtbaren erscheinen am Gerät Homematic CCU, oder keine.
- **Abfrageintervall**: 30 s standardmäßig, von 10 s bis 5 min.
- **Sprache der Namen**: die Sprache der Funktionsnamen, die beim Hinzufügen eines Geräts vergeben
  werden.

Öffne danach den Reiter **Entdecken** und füge die gewünschten Geräte hinzu. **Verbindung testen**
liest die CCU und sagt, was sie gefunden hat: ihre Firmware, die Anzahl der Geräte für Gladys, der
Programme und der Systemvariablen.

**Wie die CCU gelesen wird.** Die CCU meldet ihre Änderungen, indem sie einen Server zurückruft,
den die Integration öffnen müsste; die Sandbox von Gladys gibt Integrationen keinen eingehenden
Port, also liest die Integration die CCU: In jedem Intervall fragt **ein** kurzes Skript die CCU
nach den Werten, die sie bereits kennt, denen der zu Gladys hinzugefügten Geräte. Nichts geht über
Funk, der Duty Cycle wird nicht verbraucht, und die Last der CCU bleibt gleich, egal wie viele
Geräte es sind. Ein Befehl wird drei Sekunden nach dem Senden erneut gelesen.

## Geräte

Ein Gladys-Gerät pro Homematic-Gerät, mit dem Namen, den es in der CCU hat. Ein Gerät mit mehreren
Ausgängen bekommt nummerierte Funktionen (Schalter 1, Schalter 2…). Jedes Gerät mit Batterien hat
**Batterie schwach**. Ein Gerät, das die CCU als nicht erreichbar meldet, zeigt das Symbol
„nicht erreichbar“.

### Thermostate und Heizkörperthermostate

Homematic-IP-Heizkörperthermostate und Wandthermostate (HmIP-eTRV, HmIP-WTH, HmIP-BWTH,
HmIP-STH…), Heizungsgruppen, Homematic HM-CC-RT-DN und HM-TC-IT-WM-W-EU:

- **Temperatur**, **Luftfeuchtigkeit** (wenn das Thermostat sie misst);
- **Solltemperatur**, von 4,5 °C (aus) bis 30,5 °C, in halben Grad;
- **Heizmodus**: Automatik (das Wochenprogramm der CCU), Heizen (manueller Sollwert) oder aus
  (4,5 °C). Von „aus“ auf „Heizen“ stellt 20 °C ein;
- **Heizen**: ob das Ventil offen ist (Gladys hat keinen Funktionstyp für eine Ventilöffnung in
  Prozent);
- **Fenster (Thermostat)**: das vom Thermostat erkannte offene Fenster.

Das Relais eines Wandthermostats, das eine Fußbodenheizung steuert, ist in Gladys kein Schalter:
Es folgt der Regelung der CCU.

### Fenster- und Türkontakte

**Öffnung** für die Kontakte (HmIP-SWDO, HmIP-SCI, HM-Sec-SC…), **Fenstergriff** für die Griffe
(HmIP-SRH, HM-Sec-RHS): Ein gekippter Griff zählt als offen.

### Bewegungs-, Anwesenheits-, Rauch- und Wassermelder

**Bewegung** und **Beleuchtungsstärke** (HmIP-SMI, HM-Sec-MDIR…), **Anwesenheit** (HmIP-SPI),
**Rauch** (nur der Melder, der den Rauch sieht: Die anderen der Gruppe, die nur mitklingeln,
bleiben auf 0), **Wasseraustritt** (HmIP-SWD, HM-Sec-WDS).

### Schalter, Steckdosen und Energiezähler

**Schalter** für jeden Ausgang (HmIP-PS, HmIP-PSM, HmIP-BSM, HmIP-FSM, HmIP-DRSI4, HM-LC-Sw…), mit
**Leistung**, **Energie** (kWh), **Spannung** und **Strom**, wenn das Gerät sie misst. Eine
Zählerschnittstelle (HmIP-ESI) liefert ihre Leistung (negativ bei Einspeisung) und ihre
Zählerstände.

### Rollläden, Jalousien und Dimmer

**Position** (0 % zu, 100 % offen) und **Rollladen** (öffnen, schließen, stoppen) für die Rollladen-
und Jalousieaktoren (HmIP-BROLL, HmIP-FBL, HM-LC-Bl1…). **Licht** und **Helligkeit** für die Dimmer
(HmIP-BDT, HM-LC-Dim…).

### Wetter- und Klimasensoren

**Temperatur**, **Luftfeuchtigkeit**, **Beleuchtungsstärke**, **Windgeschwindigkeit**,
**Luftdruck** und **Regen**, je nachdem, was der Sensor misst (HmIP-SWO, HmIP-STHO, HmIP-SRD,
HM-WDS…).

### Das Gerät Homematic CCU

**Servicemeldungen** und **Alarmmeldungen**: die Zähler der CCU. Dazu eine Funktion pro sichtbarer
Systemvariable, nur lesbar: Logikwerte und Alarme als an/aus, die anderen als Text (eine
Werteliste zeigt den Namen ihres Werts, eine Zahl ihre Einheit).

Schlösser, Türöffner, Garagentore, Fensterantriebe und Sirenen sind aus Gladys nie steuerbar: Ein
Fehler würde das Haus öffnen oder einen Alarm verstummen lassen. Deren Batterien und Tasten bleiben
lesbar.

## Szenen-Auslöser: Homematic-Taste gedrückt

**Homematic-Taste gedrückt** startet eine Szene, wenn eine Taste einer Fernbedienung, eines
Wandtasters oder ein Eingang betätigt wird (HmIP-WRC2/6, HmIP-BRC2, HmIP-KRCA, HmIP-DSD-PCB,
HM-PB-2-WM55…). Filter: das Gerät, die **Nummer der Taste** (der Kanal der Taste in der CCU, 1 für
die erste), **kurzer** oder **langer** Tastendruck. Die Szene kann den Gerätenamen, die Nummer der
Taste und den Tastendruck verwenden.

Füge die Fernbedienung zuerst in Gladys hinzu (ihr Gerät zeigt ihre Batterie). Der Tastendruck
wird bei der nächsten Abfrage der CCU erkannt: bei einem Intervall von 10 s innerhalb von 10 s.
Zwei Drücke auf dieselbe Taste zwischen zwei Abfragen zählen als einer.

## Szenen-Aktion: CCU-Programm starten

**CCU-Programm starten** startet ein Programm der CCU anhand seines Namens, wie er in der CCU
steht (Programme und Verknüpfungen), ohne Beachtung der Groß- und Kleinschreibung. Der Name
akzeptiert Szenenvariablen. Ein deaktiviertes Programm wird nicht gestartet.

## Widget: Homematic CCU

Das Widget **Homematic CCU** zeigt die Service- und Alarmmeldungen der CCU, die nicht erreichbaren
Geräte und die schwachen Batterien unter den zu Gladys hinzugefügten Geräten, und bis zu vier
Tasten, die CCU-Programme starten: Gib ihre Namen, durch Kommas getrennt, in den Einstellungen des
Widgets ein. Jede Taste fragt nach einer Bestätigung.

## Szenenbeispiele

- **Türklingel**: Auslöser **Homematic-Taste gedrückt** an der HmIP-DSD-PCB, Taste 1 → eine
  Nachricht mit einem Kamerabild senden.
- **Haus verlassen**: langer Druck auf Taste 4 des Schlüsselbund-Senders → die Lichter
  ausschalten, dann **CCU-Programm starten** „Abwesend“, um die Heizung abzusenken.
- **Fenster offen**: eine Fenster-**Öffnung** auf 0 (offen) für 5 Minuten → eine Nachricht
  „schließ das Fenster, die Heizung läuft“ senden.

## Fehlerbehebung

- **Die CCU antwortet nicht**: Prüfe die Adresse, ob Gladys die CCU erreicht (gleiches Netz, keine
  Firewall dazwischen) und ob sich die Weboberfläche im Browser öffnet.
- **Die CCU leitet auf HTTPS um**: Die CCU-Option „automatische Weiterleitung auf HTTPS“ ist an:
  Schreib die Adresse mit `https://`.
- **Benutzer oder Passwort abgelehnt**: Prüfe sie in der CCU (Einstellungen → Benutzerverwaltung).
  Die CCU lehnt eine Anmeldung auch ab, wenn zu viele Sitzungen offen sind; diese laufen nach 30
  Minuten ab.
- **Der CCU-Benutzer muss Administrator sein**: Gib dem Benutzer die Administratorrolle, oder
  nutze `Admin`.
- **Ein Gerät fehlt**: Es muss im Posteingang der CCU fertig eingerichtet und seine Schnittstelle
  angehakt sein. Suche nach dem Hinzufügen eines Geräts zur CCU erneut im Reiter Entdecken.
- **Eine Sensorfunktion fehlt**: Diese erscheint, sobald die CCU einen Wert dafür erhalten hat; suche
  später erneut.
- Protokolle: in Gladys, **Einstellungen → System → Integrationen**. Setze `LOG_LEVEL=debug`, um
  jede Abfrage zu sehen.

## Grenzen

- Ohne die Hardware entwickelt: Rückmeldungen willkommen.
- Keine Echtzeit: Die Werte folgen dem Abfrageintervall (bestenfalls 10 s), ein Tastendruck auch.
- Keine Konfiguration der Geräte (Wochenprogramme, Parameter), kein Anlernen: Nutze die CCU.
- Die Systemvariablen sind nur lesbar; Programme lassen sich starten, aber nicht bearbeiten.
- CUxD, CCU-Jack und andere Zusatz-Schnittstellen werden nicht gelesen.
- Eine CCU pro Installation der Integration.
