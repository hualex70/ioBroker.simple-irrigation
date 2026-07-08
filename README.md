![Logo](admin/simple-irrigation.png)
# ioBroker.simple-irrigation

[![NPM version](https://img.shields.io/npm/v/iobroker.simple-irrigation.svg)](https://www.npmjs.com/package/iobroker.simple-irrigation)
[![Downloads](https://img.shields.io/npm/dm/iobroker.simple-irrigation.svg)](https://www.npmjs.com/package/iobroker.simple-irrigation)
![Number of Installations](https://iobroker.live/badges/simple-irrigation-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/simple-irrigation-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.simple-irrigation.png?downloads=true)](https://nodei.co/npm/iobroker.simple-irrigation/)

**Tests:** ![Test and Release](https://github.com/hualex/ioBroker.simple-irrigation/workflows/Test%20and%20Release/badge.svg)

## Einfache Bewässerungssteuerung mit Zonen für ioBroker

Dieser Adapter ermöglicht eine flexible, zonenbasierte Steuerung von Gartenbewässerungs-Ventilen. Die Konfiguration verbindet die physische Hardware (z.B. Funk-Relais, Zigbee- oder Homematic-Aktoren) mit virtuellen Steuerungs-Datenpunkten, die sich perfekt in jede VIS einbinden lassen.

### Kernfeatures
* **Echtzeit-Anpassung:** Beregnungsdauer und Durchflussmengen können im laufenden Betrieb ohne Adapter-Neustart direkt über ioBroker-Objekte verändert werden.
* **Integrierter Hardwareschutz (Not-Aus):** Bei jedem Neustart des Adapters oder nach einem Stromausfall werden alle konfigurierten Hardware-Ventile sowie das optionale Hauptventil (Master-Valve) automatisch geschlossen.
* **Verbrauchsrechner:** Automatische Erfassung des Wasserverbrauchs pro Minute, pro Gießvorgang und pro Woche.
* **Automatischer Timer** Vollwertige Zeitsteuerung via Cron-Job basierend auf frei wählbaren Wochentagen.
* **History-Log:** Integrierte Ereignis-Historie für die letzten 20 Aktionen im System, optimiert als kompaktes JSON für Visualisierungen.
* **Manueller Zonenstart** Jede Zone kann individuell auch außerhalb der automatischen Gießkette gesteuert werden 
* **optionales Hauptventil** Unterstützung eines Hauptventiles und Stellzeit
* **optionaler Regensensor** Unterstützung eines Regensensors zum Unterbrechung temporären Aussetzen der Gießkette
* **Gießketten-Pause** Pausefunktion der Gießkette (z.B., wenn eine Druckerhöhung mit Zwischenpuffer im Einsatz ist und der Puffer leer läuft, kann zum Wiederbefüllen des Puffers die Pausefunktion genutzt werden)

---

## Bedienung & Datenpunkte (VIS-Integration)

Da die Steuerung autark über die ioBroker-Objekte läuft, können folgende States direkt in der VIS beschrieben und gelesen werden:

### Globale Steuerung (`autoTimer.*`)
* `autoTimer.enabled`: Aktiviert oder deaktiviert den automatischen Zeitplan.
* `autoTimer.abort`: Ein Button, um eine laufende Bewässerung sofort vollständig abzubrechen.
* `autoTimer.isPaused`: Pausiert die aktuelle Beregnung (z.B. bei leerer Zisterne oder leerem Druckerhöhungspuffer ).
* `autoTimer.startMinute`: Startzeit (Minute) der Automatikfunktion
* `autoTimer.startHour`: Startzeit (Stunde) der Automatikfunktion
* `autoTimer.days.monday ... sunday`: aktive Wochentage der Automatikfunktion

### Ereignisprotokoll (`history.log`)
* `history.log`: die letzten 20 Ereignisse der Steuerung

### Zonen-Steuerung (`zone_X_*`)
Jede konfigurierte Zone erhält einen eigenen Ordner im Objektbaum:
* `zone_X.duration`: Die gewünschte Beregnungsdauer in Minuten (Standard: `15`).
* `zone_X.litersPerMin`: Der Wasserverbrauch pro Minute zur exakten Volumenberechnung (Standard: `10`).
* `zone_X.active`: Schaltet die Zone manuell ein (`true`) oder aus (`false`).
* `zone_X.enabled`: aktiviert /deaktiviert die betreffende Zone (`true`) oder (`false`).
* `zone_X.remainingSeconds`: Zeigt live die Restlaufzeit der aktuellen Zone an.

### Regensensor (optional) (`rainSensor.*`)
falls ein (optionaler) Regensensor angegeben ist werden folgende Objekte angelegt:
* `rainSensor.use`: Regensensor in der Gießkette berücksichtigen (Standard: `true`)
* `rainSensor.invert`: Regensensor-Logik umkehren (Standard: `false`)
* `rainSensor.isBypassedByRain`: nur lesbar, by `true` wird die Gießkette nicht ausgeführt oder unterbrochen

### Hauptventil (optional) (`MasterValve.*`)
falls ein (optionales) Hauptwasserventil angegeben ist werden folgende Objekte angelegt:
* `masterValve.state`: aktueller Zustand des Hauptventiles, kann auch direkt gesteuert werden
* `masterValve.isMoving`: falls in der Adapterkonfiguraton eine Ventil-Stellzeit angegeben wird, wird diese berücksichtigt und über das Objekt angezeigt

---

## Changelog

### 0.0.1 (2026-07-08)
* (hualex) initial release
* (hualex) optimized object structure for neustart-free VIS live updates
* (hualex) added automatic hardware safety loop on startup (fail-safe protection)
* (hualex) limited history log to 20 datasets for database performance

---

## License
MIT License

Copyright (c) 2026 hualex <alexander.huhn@sprint-net.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.