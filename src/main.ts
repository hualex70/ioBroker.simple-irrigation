import * as utils from '@iobroker/adapter-core';
import { CronJob } from 'cron'; // FIX: Moderner ESM-Import statt require() für das cron-Paket (v4+)

// Interface für die Struktur einer einzelnen Zone aus der Adapter-Konfiguration
interface ZoneConfig {
    zoneName: string;
    valveStateId: string;
}

class SimpleIrrigation extends utils.Adapter {
    // FIX: Explizite Typisierung statt 'any' für bessere Typsicherheit und Autovervollständigung
    private activeSchedule: CronJob | null = null;
    private currentTimeout: ioBroker.Timeout | null | undefined = null;
    private isAborted: boolean = false;
    private activeZoneIndex: number = -1;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'simple-irrigation' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Wird aufgerufen, sobald der Adapter vom ioBroker-Controller gestartet wurde.
     */
    private async onReady(): Promise<void> {
        this.log.info('Initialisiere simple-irrigation Adapter...');

        try {
            const activeZones = this.config.zones as ZoneConfig[] | undefined;

            // ========================================================================
            // SCHRITT 0: NOT-AUS / SICHERHEITSSCHLEIFE (Zuerst alles zudrehen!)
            // ========================================================================
            this.log.info('Führe Sicherheits-Check durch: Alle Ventile werden geschlossen...');

            if (activeZones && Array.isArray(activeZones)) {
                for (let i = 0; i < activeZones.length; i++) {
                    const zone = activeZones[i];
                    if (!zone.zoneName) continue;
                    
                    const safeName = zone.zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const zoneFolderId = `zone_${i}_${safeName}`;
                    
                    // Interne Zustände sofort im ioBroker auf "aus" nullen
                    await this.setState(`${zoneFolderId}.active`, false, true);
                    await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true);

                    // Echte Hardware-Ventile per Funk/Kabel schließen
                    const valveId = zone.valveStateId;
                    if (valveId) {
                        this.log.info(`Sicherheits-Aus: Schließbefehl an Hardware-Ventil für Zone ${i + 1} (${valveId})`);
                        await this.setForeignStateAsync(valveId, false);
                    }
                }
            }

            // Auch das Hauptventil (Master Valve) explizit schließen
            await this.setState('masterValve.state', false, true);
            if (this.config.useMasterValve && this.config.masterValveStateId) {
                this.log.info(`Sicherheits-Aus: Schließbefehl an Hauptventil (${this.config.masterValveStateId})`);
                await this.setForeignStateAsync(this.config.masterValveStateId, false);
            }
            this.log.info('Sicherheits-Check erfolgreich beendet. Alle Ventile geschlossen.');

            // ========================================================================
            // SCHRITT 1 & 2: Bereinigung veralteter Zonen-Ordner ("Leichen")
            // ========================================================================
            this.log.info('Prüfe auf veraltete Zonen-Ordner im Objektbaum...');
            const currentValidFolderIds: string[] = [];
            
            // Generiere IDs für alle aktuell in der Config hinterlegten Zonen
            if (activeZones && Array.isArray(activeZones)) {
                for (let i = 0; i < activeZones.length; i++) {
                    if (activeZones[i].zoneName) {
                        const safeName = activeZones[i].zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                        currentValidFolderIds.push(`zone_${i}_${safeName}`);
                    }
                }
            }

            // Vergleiche vorhandene ioBroker-Kanäle mit den aktiven Config-IDs und lösche "Leichen"
            const channels = await this.getChannelsAsync();
            if (channels && Array.isArray(channels)) {
                for (const channel of channels) {
                    const channelId = channel._id;
                    const channelName = channelId.split('.').pop();
                    if (channelName && channelName.startsWith('zone_') && !currentValidFolderIds.includes(channelName)) {
                        this.log.warn(`Veralteten Zonen-Ordner gefunden: [${channelName}]. Lösche Datenpunkte...`);
                        await this.delObjectAsync(channelName, { recursive: true });
                    }
                }
            }
            this.log.info('Bereinigung der Zonen-Leichen erfolgreich abgeschlossen.');
        } catch (error: any) {
            this.log.error(`Fehler während der Sicherheits-Initialisierung oder Bereinigung: ${error.message}`);
        }

        // --- Globale Steuerungsobjekte (Struktur-Aufbau) ---
        await this.setObjectNotExistsAsync('autoTimer.enabled', { type: 'state', common: { name: 'Automatische Bewässerung aktivieren', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.isRunning', { type: 'state', common: { name: 'Bewässerung läuft aktuell', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.abort', { type: 'state', common: { name: 'Laufende Bewässerung sofort abbrechen', type: 'boolean', role: 'button', read: true, write: true, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.isPaused', { type: 'state', common: { name: 'Bewässerung pausieren (z.B. Zisterne leer)', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.startHour', { type: 'state', common: { name: 'Start Stunde', type: 'number', role: 'value.datetime', min: 0, max: 23, read: true, write: true, def: 6 }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.startMinute', { type: 'state', common: { name: 'Start Minute', type: 'number', role: 'value.datetime', min: 0, max: 59, read: true, write: true, def: 0 }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.totalLitersCurrentCycle', { type: 'state', common: { name: 'Verbrauch aktueller/letzter Gießzyklus', type: 'number', role: 'value', unit: 'l', read: true, write: false, def: 0 }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.litersThisWeek', { type: 'state', common: { name: 'Verbrauch diese Woche gesamt', type: 'number', role: 'value', unit: 'l', read: true, write: false, def: 0 }, native: {} });
        
        // Für die Zisternen-Pause (Visuelle Rückmeldung)
        await this.setObjectNotExistsAsync('autoTimer.isPausedVisual', { type: 'state', common: { name: 'Blink-Status bei Zisternen-Pause', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
        
        // History
        await this.setObjectNotExistsAsync('history.log', { type: 'state', common: { name: 'Logbuch der letzten Ereignisse', type: 'string', role: 'json', read: true, write: false, def: '[]' }, native: {} });
        
        // Regensensor
        if (this.config.useRainSensor) {
            await this.setObjectNotExistsAsync('rainSensor.use', { type: 'state', common: { name: 'Regensensor berücksichtigen', type: 'boolean', role: 'switch', read: true, write: true, def: true }, native: {} });
            await this.setObjectNotExistsAsync('rainSensor.invert', { type: 'state', common: { name: 'Sensor-Logik invertieren (!)', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
            await this.setObjectNotExistsAsync('rainSensor.isBypassedByRain', { type: 'state', common: { name: 'Bewässerung wegen Regen blockiert', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
            this.subscribeStates('rainSensor.use');
            this.subscribeStates('rainSensor.invert');
        }
        
        // Masterventil
        if (this.config.useMasterValve) {
            await this.setObjectNotExistsAsync('masterValve.state', { type: 'state', common: { name: 'Hauptventil Status (offen/zu)', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
            await this.setObjectNotExistsAsync('masterValve.isMoving', { type: 'state', common: { name: 'Hauptventil fährt gerade', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
            this.subscribeStates('masterValve.state');
        }
        
        // Wochentage dynamisch anlegen
        const days = [{ id: 'monday', name: 'Montag' }, { id: 'tuesday', name: 'Dienstag' }, { id: 'wednesday', name: 'Mittwoch' }, { id: 'thursday', name: 'Donnerstag' }, { id: 'friday', name: 'Freitag' }, { id: 'saturday', name: 'Samstag' }, { id: 'sunday', name: 'Sonntag' }];
        for (const day of days) {
            await this.setObjectNotExistsAsync(`autoTimer.days.${day.id}`, { type: 'state', common: { name: `Aktiv am ${day.name}`, type: 'boolean', role: 'switch', read: true, write: true, def: true }, native: {} });
        }
        await this.setObjectNotExistsAsync('autoTimer.cronExpression', { type: 'state', common: { name: 'Aktiver Cronjob String', type: 'string', role: 'text', read: true, write: false, def: '0 6 * * 1-7' }, native: {} });

        // --- Zonen-Ordner und Unter-Datenpunkte dynamisch erstellen ---
        const zones = this.config.zones as ZoneConfig[] | undefined;
        if (zones && Array.isArray(zones) && zones.length > 0) {
            for (let i = 0; i < zones.length; i++) {
                const zone = zones[i];
                if (!zone.zoneName) continue;
                const safeName = zone.zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const zoneFolderId = `zone_${i}_${safeName}`;

                await this.setObjectNotExistsAsync(zoneFolderId, { type: 'channel', common: { name: zone.zoneName }, native: {} });
                await this.setObjectNotExistsAsync(`${zoneFolderId}.zoneName`, { type: 'state', common: { name: 'Zonenname', type: 'string', role: 'text', read: true, write: false, def: zone.zoneName }, native: {} });
                await this.setObjectNotExistsAsync(`${zoneFolderId}.litersPerCycle`, { type: 'state', common: { name: 'Wasserverbrauch pro Gießvorgang', type: 'number', role: 'value', unit: 'l', read: true, write: false, def: 0 }, native: {} });
                await this.setObjectNotExistsAsync(`${zoneFolderId}.startTime`, { type: 'state', common: { name: 'Startzeit letzte Bewässerung', type: 'string', role: 'text', read: true, write: false, def: '--:--' }, native: {} });
                await this.setObjectNotExistsAsync(`${zoneFolderId}.stopTime`, { type: 'state', common: { name: 'Stoppzeit letzte Bewässerung', type: 'string', role: 'text', read: true, write: false, def: '--:--' }, native: {} });
                await this.setObjectNotExistsAsync(`${zoneFolderId}.remainingSeconds`, { type: 'state', common: { name: 'Restlaufzeit', type: 'number', role: 'value.duration', unit: 's', read: true, write: false, def: 0 }, native: {} });
                await this.setObjectNotExistsAsync(`${zoneFolderId}.enabled`, { type: 'state', common: { name: 'Zone für automatischen Timer aktiviert', type: 'boolean', role: 'switch', read: true, write: true, def: true }, native: {} });
                
                // .active hält im native-Objekt die Hardware-ID
                await this.setObjectNotExistsAsync(`${zoneFolderId}.active`, { type: 'state', common: { name: 'Zone läuft aktuell', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: { targetValveId: zone.valveStateId } });
                
                // Beregnungsdauer (Minuten) - autark über Objekte
                await this.setObjectNotExistsAsync(`${zoneFolderId}.duration`, { type: 'state', common: { name: 'Beregnungsdauer (Minuten)', type: 'number', role: 'value.duration', min: 1, max: 180, unit: 'min', read: true, write: true, def: 15 }, native: {} });
                
                // Wasserverbrauch pro Minute (litersPerMin) - vereinheitlicht & autark über Objekte
                await this.setObjectNotExistsAsync(`${zoneFolderId}.litersPerMin`, { type: 'state', common: { name: 'Wasserverbrauch pro Minute', type: 'number', role: 'value', unit: 'l/min', read: true, write: true, def: 10 }, native: {} });
                
                // Abonnements für manuelle Änderungen im Betrieb
                this.subscribeStates(`${zoneFolderId}.active`);
                this.subscribeStates(`${zoneFolderId}.duration`);
                this.subscribeStates(`${zoneFolderId}.litersPerMin`);
            }
        }
        
        this.subscribeStates('*');
        await this.updateTimer(); // Berechne und aktiviere den Cron-Job basierend auf den geladenen States
        this.log.info('Alle Objekte erfolgreich initialisiert!');
    }

    /**
     * Wird aufgerufen, wenn der Adapter beendet wird (z.B. bei Updates oder Deaktivierung).
     */
    private async onUnload(callback: () => void): Promise<void> {
        try {
            this.isAborted = true; // Bricht alle aktiven while-Schleifen in derselben Sekunde ab
            await this.stopAllValves(); // Schaltet alle Hardware- und Software-Ventile sofort aus
            this.stopActiveTimer(); // Beendet den laufenden Cron-Job sauber
            callback();
        } catch (e) { 
            callback(); 
        }
    }

    /**
     * Überwacht alle manuellen Eingaben des Nutzers über die ioBroker-Oberflächen (z.B. VIS, Admin).
     */
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state) return;
        //this.log.info(`[Klick-Erkennung] ID: ${id} wurde auf [${state.val}] geändert (ack: ${state.ack})`);
        
        // WICHTIG: Nur reagieren, wenn ack=false (Befehl vom Nutzer). Wenn ack=true, hat der Adapter selbst den State gesetzt.
        if (state.ack) return;

        // Verarbeitung von globalen Timer-Einstellungen
        if (id.includes('autoTimer.')) {
            if (id.endsWith('.abort') && state.val === true) {
                this.log.warn('Bewässerung wurde vom Nutzer vorzeitig ABGEBROCHEN!');
                await this.stopAllValves();
                await this.setState('autoTimer.abort', false, true );
                return;
            }
            // Wenn sich Tage oder Uhrzeiten ändern, muss der Cronjob neu gebaut werden (außer bei Pause)
            if (!id.endsWith('.isPaused')) await this.updateTimer();
            await this.setState(id, state.val, true );
            return;
        }

        // Verarbeitung von Regensensor-Einstellungen (Bypass / Invertierung)
        if (id.includes('rainSensor.')) {
            this.log.info(`Regensensor-Einstellung geändert: ${id} -> ${state.val}`);
            // Wir quittieren die Änderung des Nutzers direkt, damit die gelbe Farbe im ioBroker verschwindet
            await this.setState(id, state.val, true);
            return;
        }


        // Manueller Start einer einzelnen Zone über VIS / Admin-Objektbaum
        if (id.endsWith('.active')) {
            const parts = id.split('.');
            const zoneFolderId = parts[parts.length - 2]; // Extrahiert z.B. "zone_0_rasen"
            
            if (state.val === true) {
                const indexMatch = zoneFolderId.match(/^zone_(\d+)_/);
                const zoneIndex = indexMatch ? parseInt(indexMatch[1], 10) : -1;
                const zones = this.config.zones as ZoneConfig[] | undefined;
                
                if (zones && Array.isArray(zones) && zoneIndex >= 0 && zones[zoneIndex]) {
                    this.log.info(`[MANUELLER START] Nutzer aktiviert Zone: ${zones[zoneIndex].zoneName}`);
                    // Startet die asynchrone Einzelschleife für diese Zone
                    this.startSingleZoneManual(zoneFolderId, zones[zoneIndex]);
                }
                await this.setState(id, true, true );
            }
        }
        
        // Ermöglicht die manuelle Direktsteuerung des Hauptventils durch den User (z.B. VIS-Button)
        if (id.endsWith('masterValve.state')) {
            // Falls das ack: true ist (also vom Adapter selbst gesetzt wurde), ignorieren wir es, um Endlosschleifen zu vermeiden
            if (state.ack) return; 
            this.log.info(`Manueller Steuerbefehl für Hauptventil empfangen: ${state.val}`);
            // Startet das Öffnen/Schließen asynchron im Hintergrund
            this.setMasterValve(!!state.val);
            return;
        }
    }

    /**
     * Liest die Gießzeiten und Wochentage aus und baut den Cronjob-String dynamisch zusammen.
     */
    private async updateTimer(): Promise<void> {
        const enabledState = await this.getStateAsync('autoTimer.enabled');
        const hour = Number((await this.getStateAsync('autoTimer.startHour'))?.val ?? 6);
        const minute = Number((await this.getStateAsync('autoTimer.startMinute'))?.val ?? 0);
        const enabled = enabledState ? !!enabledState.val : false;

        const cronDays: number[] = [];
        if ((await this.getStateAsync('autoTimer.days.monday'))?.val) cronDays.push(1);
        if ((await this.getStateAsync('autoTimer.days.tuesday'))?.val) cronDays.push(2);
        if ((await this.getStateAsync('autoTimer.days.wednesday'))?.val) cronDays.push(3);
        if ((await this.getStateAsync('autoTimer.days.thursday'))?.val) cronDays.push(4);
        if ((await this.getStateAsync('autoTimer.days.friday'))?.val) cronDays.push(5);
        if ((await this.getStateAsync('autoTimer.days.saturday'))?.val) cronDays.push(6);
        if ((await this.getStateAsync('autoTimer.days.sunday'))?.val) cronDays.push(0); // 0 = Sonntag im Cron

        if (cronDays.length === 0) { 
            this.stopActiveTimer(); 
            return; 
        }
        
        // Baut z.B. "30 5 * * 1,2,3,4,5" -> Jedes Jahr/Monat, Mo-Fr um 05:30 Uhr
        const cronExpression = `${minute} ${hour} * * ${cronDays.join(',')}`;
        await this.setState('autoTimer.cronExpression', cronExpression, true );
        this.stopActiveTimer();

        // Wenn der Timer scharf geschaltet ist, instanziiere den CronJob neu
        if (enabled) {
            this.log.info(`Schalte automatische Bewässerung SCHARF: Jeden [${cronDays.join(',')}] um ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Uhr`);
            // FIX: Saubere Instanziierung über die oben importierte Klasse
            this.activeSchedule = new CronJob(cronExpression, () => { 
            this.startAutomaticIrrigation(); 
            }, null, false, 'Europe/Berlin'); // false verhindert den automatischen Sofortstart bei Instanziierung

            // Danach starten wir den Job explizit und kontrolliert:
            this.activeSchedule.start();
        }
    }

    /**
     * Stoppt den aktuellen Cron-Zeitplan und räumt den Speicher auf.
     */
    private stopActiveTimer(): void {
        if (this.activeSchedule) { 
            this.activeSchedule.stop(); 
            this.activeSchedule = null; 
        }
    }

    /**
     * Die automatische Hauptschleife. Geht der Reihe nach alle aktivierten Zonen durch.
     */
    private async startAutomaticIrrigation(): Promise<void> {
        this.log.info('--- AUTOMATISCHE BEWÄSSERUNG GESTARTET ---');
        this.isAborted = false;
        await this.setState('autoTimer.totalLitersCurrentCycle', 0, true);
        let totalCycleLiters = 0;
        
        // Wettersensor-Abfrage mit dynamischen Objekten (Bypass & Invertierung)
        if (this.config.useRainSensor && this.config.rainSensorStateId) {
            // 1. Prüfen, ob der Nutzer den Sensor aktuell überhaupt berücksichtigen will
            const useSensorState = await this.getStateAsync('rainSensor.use');
            const useSensor = useSensorState ? !!useSensorState.val : true;
    
            if (useSensor) {
                // Echten Hardware-Sensorzustand auslesen
                const rainState = await this.getForeignStateAsync(this.config.rainSensorStateId);
        
                // Invertierungs-Schalter auslesen
                const invertSensorState = await this.getStateAsync('rainSensor.invert');
                const invertSensor = invertSensorState ? !!invertSensorState.val : false;
        
                // Logik berechnen: Wenn Zustand true ist und NICHT invertiert, ODER Zustand false ist und invertiert -> ES REGNET
                let isRainingDetected = rainState ? !!rainState.val : false;
                    if (invertSensor) {
                    isRainingDetected = !isRainingDetected;
                    }

                if (isRainingDetected) {
                    this.log.warn('Regensensor meldet Nässe. Automatik-Bewässerung wird übersprungen!');
            
                    // Setze die Status-Objekte für den User
                    await this.setState('rainSensor.isBypassedByRain', true, true);
                    await this.setState('autoTimer.isRunning', false, true);
            
                    // Schreibe den Vorfall in das neue JSON-History-Logbuch
                    await this.writeToHistory('Automatik übersprungen: Regensensor blockiert.');
                    return;
                }
            }
        }
        // Falls kein Regen erkannt wurde oder der Sensor deaktiviert ist: Blockade-State auf false setzen
        await this.setState('rainSensor.isBypassedByRain', false, true);
        await this.setState('autoTimer.isRunning', true, true );

        // Hauptventil automatisch öffnen und Stellzeit abwarten
        await this.setMasterValve(true);

        const zones = this.config.zones as ZoneConfig[] | undefined;
        if (!zones || !Array.isArray(zones)) { 
            await this.stopAllValves(); 
            return; 
        }

        // --- Iteration über alle konfigurierten Zonen ---
        for (let i = 0; i < zones.length; i++) {
            if (this.isAborted) break;
            this.activeZoneIndex = i;
            const zone = zones[i];
            if (!zone.zoneName) continue;

            const safeName = zone.zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const zoneFolderId = `zone_${i}_${safeName}`;
            
            // Überspringe die Zone, wenn sie im ioBroker für die Automatik deaktiviert wurde
            if (!((await this.getStateAsync(`${zoneFolderId}.enabled`))?.val ?? true)) continue;

            // Setze Zeitstempel für den VIS-Verlauf
            const now = new Date();
            await this.setState(`${zoneFolderId}.startTime`, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, true );
            await this.setState(`${zoneFolderId}.stopTime`, '--:--', true );

            // Lade Solldauer und Durchflusswerte für die Live-Berechnung
            const durationMin = Number((await this.getStateAsync(`${zoneFolderId}.duration`))?.val ?? 15);
            const litersState = await this.getStateAsync(`${zoneFolderId}.litersPerMin`);
            const litersPerMin = litersState && litersState.val !== null && !isNaN(Number(litersState.val)) ? Number(litersState.val) : 10;

            // Aktivierung im ioBroker und Hardware-Ventil öffnen
            await this.setState(`${zoneFolderId}.active`, true, true );
            if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });

            let totalSecondsRemaining = durationMin * 60;
            let actualSecondsWatered = 0;
            let localPausedState = false;
            await this.setState(`${zoneFolderId}.litersPerCycle`, 0, true );

            // --- Lokale Sekundenschleife für Countdown und Literberechnung ---
            while (totalSecondsRemaining > 0 && !this.isAborted) {
                // Erlaubt das vorzeitige Ausschalten einer einzelnen Zone während der Automatik
                const currentActiveState = await this.getStateAsync(`${zoneFolderId}.active`);
                if (currentActiveState && currentActiveState.val === false) break;

                // Zisternen-Pausenschalter prüfen
                const pauseCheck = await this.getStateAsync('autoTimer.isPaused');
                const isPausedNow = pauseCheck ? !!pauseCheck.val : false;

                // Zustand Flanke: Wurde gerade pausiert? -> Ventil zu!
                if (isPausedNow && !localPausedState) {
                    localPausedState = true;
                    if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
                }
                // Zustand Flanke: Wurde Pause aufgehoben? -> Ventil wieder auf!
                if (!isPausedNow && localPausedState) {
                    localPausedState = false;
                    if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });
                }

                // Wenn nicht pausiert ist, zähle die Zeit runter und errechne den kumulierten Verbrauch
                if (!isPausedNow) {
                    await this.setState(`${zoneFolderId}.remainingSeconds`, totalSecondsRemaining, true );
                    totalSecondsRemaining--;
                    actualSecondsWatered++;
                    
                    // Formel: (Sekunden / 60) * LiterProMinute. Gerundet auf 2 Nachkommastellen.
                    const liveLiters = Math.round((actualSecondsWatered / 60) * litersPerMin * 100) / 100;
                    await this.setState(`${zoneFolderId}.litersPerCycle`, liveLiters, true);
                    // Jede Sekunde den globalen Wert für den aktuellen Zyklus updaten
                    const currentZoneTickLiters = (1 / 60) * litersPerMin;
                    totalCycleLiters += currentZoneTickLiters;
                    await this.setState('autoTimer.totalLitersCurrentCycle', Math.round(totalCycleLiters * 100) / 100, true);
                }
                await this.sleep(1000); // 1 Sekunde Pause vor dem nächsten Schleifendurchlauf
            }

            // Aufräumarbeiten nach Beendigung der aktuellen Zone
            await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true );
            const end = new Date();
            await this.setState(`${zoneFolderId}.stopTime`, `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`, true );
            await this.setState(`${zoneFolderId}.active`, false, true );
            if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
        }
        await this.stopAllValves(); // Schließt am Ende alles (inkl. Master-Ventil) ab
        // Hauptventil am Ende der Kette wieder schließen
        await this.setMasterValve(false);

        //Wochenverbrauch aufaddieren
        const currentWeekState = await this.getStateAsync('autoTimer.litersThisWeek');
        const oldWeekLiters = Number(currentWeekState?.val ?? 0);
        await this.setState('autoTimer.litersThisWeek', Math.round((oldWeekLiters + totalCycleLiters) * 100) / 100, true);
    }

    /**
     * Gießschleife für den manuellen Individualstart einer einzelnen Zone.
     * Funktioniert analog zur Automatikschleife, steuert jedoch isoliert nur eine Zone an.
     */
    private async startSingleZoneManual(zoneFolderId: string, zone: ZoneConfig): Promise<void> {
        this.isAborted = false;
        const now = new Date();
        await this.setState(`${zoneFolderId}.startTime`, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, true );
        await this.setState(`${zoneFolderId}.stopTime`, '--:--', true );

        const durationMin = Number((await this.getStateAsync(`${zoneFolderId}.duration`))?.val ?? 15);
        const litersState = await this.getStateAsync(`${zoneFolderId}.litersPerMin`);
        const litersPerMin = litersState && litersState.val !== null && !isNaN(Number(litersState.val)) ? Number(litersState.val) : 10;

        // Hauptventil vor dem manuellen Zonenstart öffnen
        await this.setMasterValve(true);

        if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });

        let totalSecondsRemaining = durationMin * 60;
        let actualSecondsWatered = 0;
        let localPausedState = false;
        await this.setState(`${zoneFolderId}.litersPerCycle`, 0, true );

        while (totalSecondsRemaining > 0 && !this.isAborted) {
            const currentActiveState = await this.getStateAsync(`${zoneFolderId}.active`);
            if (currentActiveState && currentActiveState.val === false) {
                this.log.info(`[MANUELLER STOPP] Ausschalten für ${zone.zoneName}.`);
                break;
            }

            const pauseCheck = await this.getStateAsync('autoTimer.isPaused');
            const isPausedNow = pauseCheck ? !!pauseCheck.val : false;

            if (isPausedNow && !localPausedState) {
                localPausedState = true;
                if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
            }
            if (!isPausedNow && localPausedState) {
                localPausedState = false;
                if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });
            }

            if (!isPausedNow) {
                await this.setState(`${zoneFolderId}.remainingSeconds`, totalSecondsRemaining, true );
                totalSecondsRemaining--;
                actualSecondsWatered++;
                const liveLiters = Math.round((actualSecondsWatered / 60) * litersPerMin * 100) / 100;
                await this.setState(`${zoneFolderId}.litersPerCycle`, liveLiters, true );
            }
            await this.sleep(1000);
        }

        this.log.info(`[Zone Beendigung] ${zone.zoneName} nach ${actualSecondsWatered}s.`);
        await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true );
        const end = new Date();
        await this.setState(`${zoneFolderId}.stopTime`, `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`, true );

        if (zone.valveStateId) await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
        
        // Hauptventil nach manuellem Zonenstopp wieder schließen
        if (this.config.useMasterValve && this.config.masterValveStateId) {
            await this.setMasterValve(false);
        }

    // 1. Wir holen uns den aktuellen Stand des Datenpunkts, um zu sehen, wie viele Sekunden übrig blieben
    const remainingSecondsState = await this.getStateAsync(`${zoneFolderId}.remainingSeconds`);
    const lastRemainingSeconds = Number(remainingSecondsState?.val ?? 0);

    // 2. Berechne die tatsächlich bewässerten Sekunden (genutzte Variablen-Namen angepasst!)
    const finalManualSeconds = Math.max(0, durationMin * 60 - lastRemainingSeconds);
    const manualLitersUsed = Math.round((finalManualSeconds / 60) * litersPerMin * 100) / 100;

    if (manualLitersUsed > 0) {
    // Aktuellen Wochenwert auslesen
    const currentWeekState = await this.getStateAsync('autoTimer.litersThisWeek');
    const oldWeekLiters = Number(currentWeekState?.val ?? 0);
    
    // Aufaddieren und speichern
    await this.setState('autoTimer.litersThisWeek', Math.round((oldWeekLiters + manualLitersUsed) * 100) / 100, true);
    
    // Eintrag ins Logbuch schreiben
    await this.writeToHistory(`Manuelle Bewässerung: ${zone.zoneName} (${manualLitersUsed}l)`);
    }
        
        await this.setState(`${zoneFolderId}.active`, false, true );
    }

    /**
     * Sicherheitsfunktion: Schaltet ausnahmslos alle internen States, echten Hardware-Ventile 
     * sowie das Master-Ventil sofort ab und setzt Timer zurück.
     */
    private async stopAllValves(): Promise<void> {
    this.isAborted = true;
    if (this.currentTimeout) { 
        this.clearTimeout(this.currentTimeout); 
        this.currentTimeout = null; 
    }

    const zones = this.config.zones as ZoneConfig[] | undefined;
    if (zones && Array.isArray(zones)) {
        for (let i = 0; i < zones.length; i++) {
            const zone = zones[i];
            if (!zone.zoneName) continue;
            const safeName = zone.zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const zoneFolderId = `zone_${i}_${safeName}`;
            
            await this.setState(`${zoneFolderId}.active`, false, true);
            await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true);
            if (zone.valveStateId) await this.setForeignState(zone.valveStateId, false, false);
        }
    }

    // FIX: Nutze die neue Logik für das Hauptventil, aber schalte es hier im Not-Aus direkt hart ab
    if (this.config.useMasterValve && this.config.masterValveStateId) {
        await this.setForeignState(this.config.masterValveStateId, false, false);
        await this.setState('masterValve.state', false, true);
        await this.setState('masterValve.isMoving', false, true);
    }
    
    await this.setState('autoTimer.isRunning', false, true);
    this.activeZoneIndex = -1;
    }

    /**
     * Eigene Hilfsmethode zur Verzögerung (Sleep), die über das ioBroker-eigene setTimeout registriert wird, 
     * damit der Adapter beim Beenden offene Timeouts sauber killen kann.
     */
    private sleep(ms: number): Promise<void> { 
        return new Promise((resolve) => { 
            this.currentTimeout = this.setTimeout(resolve, ms); 
        }); 
    }

    private async writeToHistory(message: string): Promise<void> {
         try {
            const state = await this.getStateAsync('history.log');
            let logArray: Array<{ ts: string; msg: string }> = [];
            
            if (state && typeof state.val === 'string') {
                try { 
                    logArray = JSON.parse(state.val); 
                } catch { 
                    logArray = []; 
                }
            }
            
            const now = new Date();
            // TIPP: Leerzeichen nach dem Punkt beim Monat entfernt für ein sauberes Format (z.B. "08.07. 11:15" -> "08.07. 11:15")
            const timestamp = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}. ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            
            // Neues Ereignis vorne anfügen und auf max. 20 Einträge begrenzen
            logArray.unshift({ ts: timestamp, msg: message });
            if (logArray.length > 20) {
                logArray = logArray.slice(0, 20);
            }
            
            // WICHTIG: Verwende hier setStateAsync (mit Async!) passend zu deiner asynchronen Methode
            await this.setState('history.log', JSON.stringify(logArray), true);
        } catch (err: any) {
            this.log.error(`Fehler beim Schreiben ins History-Log: ${err.message}`);
        }
    }

    /**
    * Steuert das Hauptventil (Master-Valve), setzt Status-States und wartet die konfigurierte Stellzeit ab.
    * @param open true = öffnen, false = schließen
    */
    private async setMasterValve(open: boolean): Promise<void> {
        if (!this.config.useMasterValve || !this.config.masterValveStateId) return;

        this.log.info(`Hauptventil wird angesteuert -> ${open ? 'ÖFFNEN' : 'SCHLIESSEN'}`);
    
        // Signalisiere: Ventil bewegt sich gerade
        await this.setState('masterValve.isMoving', true, true);
    
        // Sende den echten Schaltbefehl an die Hardware (ack: false, da es ein Steuerbefehl ist!)
        await this.setForeignState(this.config.masterValveStateId, open, false);
        // Aktualisiere unseren eigenen internen Status
        await this.setState('masterValve.state', open, true);

        // Stellzeit (Verzögerung) aus der Adapterkonfiguration abwarten
        const runTimeSeconds = this.config.masterValveDelay || 0;
            if (runTimeSeconds > 0) {
            this.log.info(`Warte ${runTimeSeconds} Sekunden Stellzeit (Kugelhahnlaufzeit) ab...`);
            await this.sleep(runTimeSeconds * 1000);
            }

            // Ventil hat die Endlage erreicht, Bewegung abgeschlossen
            await this.setState('masterValve.isMoving', false, true);
            this.log.info(`Hauptventil hat Endlage erreicht (${open ? 'OFFEN' : 'ZU'}).`);
    }
}

// Einstiegspunkt für den js-controller
if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> = {}) => new SimpleIrrigation(options);
} else { 
    (() => new SimpleIrrigation())(); 
}