"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const cron_1 = require("cron"); // ESM-Import instead of require() for cron (v4+)
class SimpleIrrigation extends utils.Adapter {
    activeSchedule = null;
    currentTimeout = null;
    isAborted = false;
    activeZoneIndex = -1;
    constructor(options = {}) {
        super({ ...options, name: 'simple-irrigation' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    // wird aufgerufen, sobald der Adapter vom ioBroker-Controller gestartet wurde.
    async onReady() {
        this.log.info('Initialisiere simple-irrigation Adapter...');
        try {
            const activeZones = this.config.zones;
            // ========================================================================
            // SCHRITT 0: NOT-AUS / SICHERHEITSSCHLEIFE (Ventile schließen)
            // ========================================================================
            this.log.info('Führe Sicherheits-Check durch: Alle Ventile werden geschlossen...');
            if (activeZones && Array.isArray(activeZones)) {
                for (let i = 0; i < activeZones.length; i++) {
                    const zone = activeZones[i];
                    if (!zone.zoneName)
                        continue;
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
            // Hauptventil (Master Valve) explizit schließen
            if (this.config.useMasterValve) {
                await this.setMasterValve(false);
            }
            this.log.info('Sicherheits-Check erfolgreich beendet. Alle Ventile geschlossen.');
            // ========================================================================
            // SCHRITT 1 & 2: Bereinigung veralteter Zonen-Ordner
            // ========================================================================
            this.log.info('Prüfe auf veraltete Zonen-Ordner im Objektbaum...');
            const currentValidFolderIds = [];
            // IDs für alle aktuell in der Config hinterlegten Zonen generieren
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
        }
        catch (error) {
            this.log.error(`Fehler während der Sicherheits-Initialisierung oder Bereinigung: ${error.message}`);
        }
        // --- Globale Steuerungsobjekte ---
        await this.setObjectNotExistsAsync('autoTimer.enabled', { type: 'state', common: { name: 'Automatische Bewässerung aktivieren', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.isRunning', { type: 'state', common: { name: 'Bewässerung läuft aktuell', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.abort', { type: 'state', common: { name: 'Laufende Bewässerung sofort abbrechen', type: 'boolean', role: 'button', read: true, write: true, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.isPaused', { type: 'state', common: { name: 'Bewässerung pausieren (z.B. Zisterne leer)', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.startHour', { type: 'state', common: { name: 'Start Stunde', type: 'number', role: 'value.datetime', min: 0, max: 23, read: true, write: true, def: 6 }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.startMinute', { type: 'state', common: { name: 'Start Minute', type: 'number', role: 'value.datetime', min: 0, max: 59, read: true, write: true, def: 0 }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.totalLitersCurrentCycle', { type: 'state', common: { name: 'Verbrauch aktueller/letzter Gießzyklus', type: 'number', role: 'value', unit: 'l', read: true, write: false, def: 0 }, native: {} });
        await this.setObjectNotExistsAsync('autoTimer.litersThisWeek', { type: 'state', common: { name: 'Verbrauch diese Woche gesamt', type: 'number', role: 'value', unit: 'l', read: true, write: true, def: 0 }, native: {} });
        // --- maximale Pausenzeit ---
        await this.setObjectNotExistsAsync('autoTimer.maxPauseDuration', { type: 'state', common: { name: 'Maximale Pausendauer bis automatischem Abbruch (Minuten)', type: 'number', role: 'value', unit: 'min', read: true, write: true, def: 30 }, native: {} });
        // --- History ---
        await this.setObjectNotExistsAsync('history.log', { type: 'state', common: { name: 'Logbuch der letzten Ereignisse', type: 'string', role: 'json', read: true, write: false, def: '[]' }, native: {} });
        // --- Regensensor ---
        if (this.config.useRainSensor) {
            await this.setObjectNotExistsAsync('rainSensor.use', { type: 'state', common: { name: 'Regensensor berücksichtigen', type: 'boolean', role: 'switch', read: true, write: true, def: true }, native: {} });
            await this.setObjectNotExistsAsync('rainSensor.invert', { type: 'state', common: { name: 'Sensor-Logik invertieren (!)', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
            await this.setObjectNotExistsAsync('rainSensor.isBypassedByRain', { type: 'state', common: { name: 'Bewässerung wegen Regen blockiert', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
            this.subscribeStates('rainSensor.use');
            this.subscribeStates('rainSensor.invert');
        }
        // --- Masterventil ---
        if (this.config.useMasterValve) {
            await this.setObjectNotExistsAsync('masterValve.state', { type: 'state', common: { name: 'Hauptventil Status (offen/zu)', type: 'boolean', role: 'switch', read: true, write: true, def: false }, native: {} });
            await this.setObjectNotExistsAsync('masterValve.isMoving', { type: 'state', common: { name: 'Hauptventil fährt gerade', type: 'boolean', role: 'value.status', read: true, write: false, def: false }, native: {} });
            this.subscribeStates('masterValve.state');
        }
        // --- Wochentage dynamisch anlegen ---
        const days = [{ id: 'monday', name: 'Montag' }, { id: 'tuesday', name: 'Dienstag' }, { id: 'wednesday', name: 'Mittwoch' }, { id: 'thursday', name: 'Donnerstag' }, { id: 'friday', name: 'Freitag' }, { id: 'saturday', name: 'Samstag' }, { id: 'sunday', name: 'Sonntag' }];
        for (const day of days) {
            await this.setObjectNotExistsAsync(`autoTimer.days.${day.id}`, { type: 'state', common: { name: `Aktiv am ${day.name}`, type: 'boolean', role: 'switch', read: true, write: true, def: true }, native: {} });
        }
        await this.setObjectNotExistsAsync('autoTimer.cronExpression', { type: 'state', common: { name: 'Aktiver Cronjob String', type: 'string', role: 'text', read: true, write: false, def: '0 6 * * 1-7' }, native: {} });
        // --- Zonen-Ordner und Unter-Datenpunkte dynamisch erstellen ---
        const zones = this.config.zones;
        if (zones && Array.isArray(zones) && zones.length > 0) {
            for (let i = 0; i < zones.length; i++) {
                const zone = zones[i];
                if (!zone.zoneName)
                    continue;
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
                // Beregnungsdauer (Minuten)
                await this.setObjectNotExistsAsync(`${zoneFolderId}.duration`, { type: 'state', common: { name: 'Beregnungsdauer (Minuten)', type: 'number', role: 'value.duration', min: 1, max: 180, unit: 'min', read: true, write: true, def: 15 }, native: {} });
                // Wasserverbrauch pro Minute (litersPerMin) 
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
    // Wird aufgerufen, wenn der Adapter beendet wird (z.B. bei Updates oder Deaktivierung).
    async onUnload(callback) {
        try {
            this.isAborted = true; // Bricht alle aktiven while-Schleifen in derselben Sekunde ab
            await this.stopAllValves();
            this.stopActiveTimer();
            callback();
        }
        catch (e) {
            callback();
        }
    }
    // Überwacht alle manuellen Eingaben des Nutzers über die ioBroker-Oberflächen (z.B. VIS, Admin).
    async onStateChange(id, state) {
        if (!state)
            return;
        if (state.ack)
            return;
        // Verarbeitung von globalen Timer-Einstellungen
        if (id.includes('autoTimer.')) {
            if (id.endsWith('.abort') && state.val === true) {
                this.log.warn('Bewässerung wurde vom Nutzer vorzeitig ABGEBROCHEN!');
                await this.stopAllValves();
                await this.writeToHistory('Bewässerung manuell abgebrochen (Not-Aus)!');
                await this.setState('autoTimer.abort', false, true);
                return;
            }
            // Wenn sich Tage oder Uhrzeiten ändern, muss der Cronjob neu gebaut werden (außer bei Pause)
            if (!id.endsWith('.isPaused'))
                await this.updateTimer();
            await this.setState(id, state.val, true);
            return;
        }
        // Verarbeitung von Regensensor-Einstellungen (Bypass / Invertierung)
        if (id.includes('rainSensor.')) {
            this.log.info(`Regensensor-Einstellung geändert: ${id} -> ${state.val}`);
            await this.setState(id, state.val, true);
            return;
        }
        // Manueller Start einer einzelnen Zone über VIS / Admin-Objektbaum
        if (id.endsWith('.active')) {
            const parts = id.split('.');
            const zoneFolderId = parts[parts.length - 2]; // Extrahiert z.B. "zone_0_rasen"
            if (state.val === true) {
                // === FIX M1: Gleichzeitiges manuelles Starten blockieren ===
                // Prüfen, ob die Automatik läuft ODER bereits eine andere Zone manuell aktiv ist
                const isRunningState = await this.getStateAsync('autoTimer.isRunning');
                const isAutoRunning = isRunningState ? !!isRunningState.val : false;
                let anyOtherZoneActive = false;
                const zonesConfig = this.config.zones;
                if (zonesConfig && Array.isArray(zonesConfig)) {
                    for (let z = 0; z < zonesConfig.length; z++) {
                        if (!zonesConfig[z].zoneName)
                            continue;
                        const sName = zonesConfig[z].zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                        const checkFolderId = `zone_${z}_${sName}`;
                        if (checkFolderId !== zoneFolderId) {
                            const zActive = await this.getStateAsync(`${checkFolderId}.active`);
                            if (zActive && zActive.val === true) {
                                anyOtherZoneActive = true;
                                break;
                            }
                        }
                    }
                }
                if (isAutoRunning || anyOtherZoneActive) {
                    this.log.warn(`[MANUELLER BLOCK] Start von ${zoneFolderId} verweigert. Es läuft bereits eine Bewässerung!`);
                    await this.setState(id, false, true); // Setze den Button sofort wieder zurück auf false
                    return;
                }
                const indexMatch = zoneFolderId.match(/^zone_(\d+)_/);
                const zoneIndex = indexMatch ? parseInt(indexMatch[1], 10) : -1;
                const zones = this.config.zones;
                if (zones && Array.isArray(zones) && zoneIndex >= 0 && zones[zoneIndex]) {
                    this.log.info(`[MANUELLER START] Nutzer aktiviert Zone: ${zones[zoneIndex].zoneName}`);
                    this.startSingleZoneManual(zoneFolderId, zones[zoneIndex]);
                }
                await this.setState(id, true, true);
            }
        }
        // Ermöglicht die manuelle Direktsteuerung des Hauptventils durch den User (z.B. VIS-Button)
        if (id.endsWith('masterValve.state')) {
            if (state.ack)
                return;
            this.log.info(`Manueller Steuerbefehl für Hauptventil empfangen: ${state.val}`);
            this.setMasterValve(!!state.val);
            return;
        }
    }
    //  Liest die Gießzeiten und Wochentage aus und baut den Cronjob-String dynamisch zusammen
    async updateTimer() {
        const enabledState = await this.getStateAsync('autoTimer.enabled');
        const hour = Number((await this.getStateAsync('autoTimer.startHour'))?.val ?? 6);
        const minute = Number((await this.getStateAsync('autoTimer.startMinute'))?.val ?? 0);
        const enabled = enabledState ? !!enabledState.val : false;
        const cronDays = [];
        if ((await this.getStateAsync('autoTimer.days.monday'))?.val)
            cronDays.push(1);
        if ((await this.getStateAsync('autoTimer.days.tuesday'))?.val)
            cronDays.push(2);
        if ((await this.getStateAsync('autoTimer.days.wednesday'))?.val)
            cronDays.push(3);
        if ((await this.getStateAsync('autoTimer.days.thursday'))?.val)
            cronDays.push(4);
        if ((await this.getStateAsync('autoTimer.days.friday'))?.val)
            cronDays.push(5);
        if ((await this.getStateAsync('autoTimer.days.saturday'))?.val)
            cronDays.push(6);
        if ((await this.getStateAsync('autoTimer.days.sunday'))?.val)
            cronDays.push(0);
        if (cronDays.length === 0) {
            this.stopActiveTimer();
            return;
        }
        const cronExpression = `${minute} ${hour} * * ${cronDays.join(',')}`;
        await this.setState('autoTimer.cronExpression', cronExpression, true);
        this.stopActiveTimer();
        if (enabled) {
            this.log.info(`Schalte automatische Bewässerung SCHARF: Jeden [${cronDays.join(',')}] um ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Uhr`);
            this.activeSchedule = new cron_1.CronJob(cronExpression, () => {
                this.startAutomaticIrrigation();
            }, null, false, 'Europe/Berlin');
            this.activeSchedule.start();
        }
    }
    stopActiveTimer() {
        if (this.activeSchedule) {
            this.activeSchedule.stop();
            this.activeSchedule = null;
        }
    }
    //  automatische Hauptschleife, geht alle aktivierten Zonen durch
    async startAutomaticIrrigation() {
        this.log.info('--- AUTOMATISCHE BEWÄSSERUNG GESTARTET ---');
        this.isAborted = false;
        await this.setState('autoTimer.totalLitersCurrentCycle', 0, true);
        let totalCycleLiters = 0;
        if (this.config.useRainSensor && this.config.rainSensorStateId) {
            const useSensorState = await this.getStateAsync('rainSensor.use');
            const useSensor = useSensorState ? !!useSensorState.val : true;
            if (useSensor) {
                const rainState = await this.getForeignStateAsync(this.config.rainSensorStateId);
                const invertSensorState = await this.getStateAsync('rainSensor.invert');
                const invertSensor = invertSensorState ? !!invertSensorState.val : false;
                let isRainingDetected = rainState ? !!rainState.val : false;
                if (invertSensor) {
                    isRainingDetected = !isRainingDetected;
                }
                if (isRainingDetected) {
                    this.log.warn('Regensensor meldet Nässe. Automatik-Bewässerung wird übersprungen!');
                    await this.setState('rainSensor.isBypassedByRain', true, true);
                    await this.setState('autoTimer.isRunning', false, true);
                    await this.writeToHistory('Automatik übersprungen: Regensensor blockiert.');
                    return;
                }
            }
        }
        await this.setState('rainSensor.isBypassedByRain', false, true);
        await this.setState('autoTimer.isRunning', true, true);
        await this.setMasterValve(true);
        const zones = this.config.zones;
        if (!zones || !Array.isArray(zones)) {
            await this.stopAllValves();
            return;
        }
        // --- Iteration über alle konfigurierten Zonen ---
        for (let i = 0; i < zones.length; i++) {
            if (this.isAborted)
                break;
            this.activeZoneIndex = i;
            const zone = zones[i];
            if (!zone.zoneName)
                continue;
            const safeName = zone.zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const zoneFolderId = `zone_${i}_${safeName}`;
            if (!((await this.getStateAsync(`${zoneFolderId}.enabled`))?.val ?? true))
                continue;
            const now = new Date();
            await this.setState(`${zoneFolderId}.startTime`, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, true);
            await this.setState(`${zoneFolderId}.stopTime`, '--:--', true);
            const durationMin = Number((await this.getStateAsync(`${zoneFolderId}.duration`))?.val ?? 15);
            const litersState = await this.getStateAsync(`${zoneFolderId}.litersPerMin`);
            const litersPerMin = litersState && litersState.val !== null && !isNaN(Number(litersState.val)) ? Number(litersState.val) : 10;
            await this.setState(`${zoneFolderId}.active`, true, true);
            if (zone.valveStateId)
                await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });
            let totalSecondsRemaining = durationMin * 60;
            let actualSecondsWatered = 0;
            let secondsInPause = 0;
            let localPausedState = false;
            await this.setState(`${zoneFolderId}.litersPerCycle`, 0, true);
            const maxPauseMin = Number((await this.getStateAsync('autoTimer.maxPauseDuration'))?.val ?? 30);
            const maxPauseSeconds = maxPauseMin * 60;
            while (totalSecondsRemaining > 0 && !this.isAborted) {
                const currentActiveState = await this.getStateAsync(`${zoneFolderId}.active`);
                if (currentActiveState && currentActiveState.val === false)
                    break;
                const pauseCheck = await this.getStateAsync('autoTimer.isPaused');
                const isPausedNow = pauseCheck ? !!pauseCheck.val : false;
                if (isPausedNow && !localPausedState) {
                    localPausedState = true;
                    if (zone.valveStateId)
                        await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
                }
                if (!isPausedNow && localPausedState) {
                    localPausedState = false;
                    if (zone.valveStateId)
                        await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });
                }
                if (!isPausedNow) {
                    secondsInPause = 0;
                    await this.setState(`${zoneFolderId}.remainingSeconds`, totalSecondsRemaining, true);
                    totalSecondsRemaining--;
                    actualSecondsWatered++;
                    const liveLiters = Math.round((actualSecondsWatered / 60) * litersPerMin);
                    await this.setState(`${zoneFolderId}.litersPerCycle`, liveLiters, true);
                    const currentZoneTickLiters = (1 / 60) * litersPerMin;
                    totalCycleLiters += currentZoneTickLiters;
                    await this.setState('autoTimer.totalLitersCurrentCycle', Math.round(totalCycleLiters * 100) / 100, true);
                }
                else {
                    secondsInPause++;
                    if (secondsInPause >= maxPauseSeconds) {
                        this.log.warn(`[AUTOMATIK] Maximale Pausendauer von ${maxPauseMin} Minuten überschritten! Breche gesamte Bewässerung ab.`);
                        await this.writeToHistory(`Abbruch: Pause-Timeout von ${maxPauseMin} Min überschritten.`);
                        // === FIX A3: isPaused automatisch wieder auf false setzen ===
                        await this.setState('autoTimer.isPaused', false, true);
                        this.isAborted = true;
                        break;
                    }
                }
                await this.sleep(1000);
            }
            // nach Beendigung der aktuellen Zone (regulär ODER Abbruch) -> aufräumen
            await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true);
            const end = new Date();
            await this.setState(`${zoneFolderId}.stopTime`, `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`, true);
            await this.setState(`${zoneFolderId}.active`, false, true);
            if (zone.valveStateId)
                await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
            // === FIX B2: Wenn abgebrochen wurde, breche die Zonenverteilung SOFORT ab ===
            if (this.isAborted) {
                this.log.info(`[AUTOMATIK] Schleife wegen vorzeitigem Abbruch bei Zone ${zone.zoneName} beendet.`);
                break;
            }
        } // Ende der äußeren Zonen-Schleife
        await this.stopAllValves(false);
        await this.setState('autoTimer.isRunning', false, true);
        //Wochenverbrauch aufaddieren
        const currentWeekState = await this.getStateAsync('autoTimer.litersThisWeek');
        const oldWeekLiters = Number(currentWeekState?.val ?? 0);
        const newWeekLiters = Math.round((oldWeekLiters + totalCycleLiters) * 100) / 100;
        await this.setState('autoTimer.litersThisWeek', newWeekLiters, true);
        // === FIX B1: Logbuch-Eintrag Logik korrigiert ===
        if (this.isAborted) {
            await this.writeToHistory('Automatische Bewässerung VORZEITIG ABGEBROCHEN!');
        }
        else {
            const roundedLiters = Math.round(totalCycleLiters * 100) / 100;
            await this.writeToHistory(`Automatische Bewässerung beendet. Gesamtverbrauch: ${roundedLiters}l`);
        }
    }
    //  Gießschleife für manuellen Individualstart einer einzelnen Zone
    async startSingleZoneManual(zoneFolderId, zone) {
        this.isAborted = false;
        const now = new Date();
        await this.setState(`${zoneFolderId}.startTime`, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, true);
        await this.setState(`${zoneFolderId}.stopTime`, '--:--', true);
        const durationMin = Number((await this.getStateAsync(`${zoneFolderId}.duration`))?.val ?? 15);
        const litersState = await this.getStateAsync(`${zoneFolderId}.litersPerMin`);
        const litersPerMin = litersState && litersState.val !== null && !isNaN(Number(litersState.val)) ? Number(litersState.val) : 10;
        await this.setMasterValve(true);
        if (zone.valveStateId)
            await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });
        let totalSecondsRemaining = durationMin * 60;
        let actualSecondsWatered = 0;
        let secondsInPause = 0;
        let localPausedState = false;
        await this.setState(`${zoneFolderId}.litersPerCycle`, 0, true);
        const maxPauseMin = Number((await this.getStateAsync('autoTimer.maxPauseDuration'))?.val ?? 30);
        const maxPauseSeconds = maxPauseMin * 60;
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
                if (zone.valveStateId)
                    await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
            }
            if (!isPausedNow && localPausedState) {
                localPausedState = false;
                if (zone.valveStateId)
                    await this.setForeignStateAsync(zone.valveStateId, { val: true, ack: false });
            }
            if (!isPausedNow) {
                secondsInPause = 0;
                await this.setState(`${zoneFolderId}.remainingSeconds`, totalSecondsRemaining, true);
                totalSecondsRemaining--;
                actualSecondsWatered++;
                const liveLiters = Math.round((actualSecondsWatered / 60) * litersPerMin * 100) / 100;
                await this.setState(`${zoneFolderId}.litersPerCycle`, liveLiters, true);
            }
            else {
                secondsInPause++;
                if (secondsInPause >= maxPauseSeconds) {
                    this.log.warn(`[MANUELL] Maximale Pausendauer von ${maxPauseMin} Minuten überschritten! Breche Bewässerung ab.`);
                    await this.writeToHistory(`Abbruch: Pause-Timeout von ${maxPauseMin} Min überschritten.`);
                    // === FIX A3: isPaused automatisch wieder auf false setzen ===
                    await this.setState('autoTimer.isPaused', false, true);
                    this.isAborted = true;
                    break;
                }
            }
            await this.sleep(1000);
        }
        this.log.info(`[Zone Beendigung] ${zone.zoneName} nach ${actualSecondsWatered}s aktiver Bewässerung.`);
        await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true);
        const end = new Date();
        await this.setState(`${zoneFolderId}.stopTime`, `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`, true);
        if (zone.valveStateId)
            await this.setForeignStateAsync(zone.valveStateId, { val: false, ack: false });
        if (this.config.useMasterValve && this.config.masterValveStateId) {
            await this.setMasterValve(false);
        }
        if (actualSecondsWatered > 0) {
            const manualLitersUsed = Math.round((actualSecondsWatered / 60) * litersPerMin * 100) / 100;
            if (manualLitersUsed > 0) {
                const currentWeekState = await this.getStateAsync('autoTimer.litersThisWeek');
                const oldWeekLiters = Number(currentWeekState?.val ?? 0);
                await this.setState('autoTimer.litersThisWeek', Math.round((oldWeekLiters + manualLitersUsed) * 100) / 100, true);
                await this.writeToHistory(`Manuelle Bewässerung: ${zone.zoneName} (${manualLitersUsed}l)`);
            }
        }
        await this.setState(`${zoneFolderId}.active`, false, true);
    }
    // Sicherheitsfunktion: Schaltet ausnahmslos alle internen States und echten Hardware-Ventile ab.
    // isEmergency = true bedeutet echter Not-Aus. bei false ist es nur das reguläre Aufräumen am Ende.
    async stopAllValves(isEmergency = true) {
        if (isEmergency) {
            this.isAborted = true;
        }
        if (this.currentTimeout) {
            this.clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }
        const zones = this.config.zones;
        if (zones && Array.isArray(zones)) {
            for (let i = 0; i < zones.length; i++) {
                const zone = zones[i];
                if (!zone.zoneName)
                    continue;
                const safeName = zone.zoneName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const zoneFolderId = `zone_${i}_${safeName}`;
                // Wenn die Zone aktiv war, schreibe vor dem Abschalten die Stop-Time
                const currentActive = await this.getStateAsync(`${zoneFolderId}.active`);
                if (currentActive && currentActive.val === true) {
                    const end = new Date();
                    await this.setState(`${zoneFolderId}.stopTime`, `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`, true);
                }
                await this.setState(`${zoneFolderId}.active`, false, true);
                await this.setState(`${zoneFolderId}.remainingSeconds`, 0, true);
                if (zone.valveStateId)
                    await this.setForeignState(zone.valveStateId, false, false);
            }
        }
        await this.setMasterValve(false);
        await this.setState('autoTimer.isRunning', false, true);
        this.activeZoneIndex = -1;
    }
    sleep(ms) {
        return new Promise((resolve) => {
            this.currentTimeout = this.setTimeout(resolve, ms);
        });
    }
    async writeToHistory(message) {
        try {
            const state = await this.getStateAsync('history.log');
            let logArray = [];
            if (state && typeof state.val === 'string') {
                try {
                    logArray = JSON.parse(state.val);
                }
                catch {
                    logArray = [];
                }
            }
            const now = new Date();
            const timestamp = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}. ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            logArray.unshift({ ts: timestamp, msg: message });
            if (logArray.length > 20) {
                logArray = logArray.slice(0, 20);
            }
            await this.setState('history.log', JSON.stringify(logArray), true);
        }
        catch (err) {
            this.log.error(`Fehler beim Schreiben ins History-Log: ${err.message}`);
        }
    }
    async setMasterValve(open) {
        if (!this.config.useMasterValve || !this.config.masterValveStateId)
            return;
        this.log.info(`Hauptventil wird angesteuert -> ${open ? 'ÖFFNEN' : 'SCHLIESSEN'}`);
        await this.setState('masterValve.isMoving', true, true);
        await this.setForeignState(this.config.masterValveStateId, open, false);
        await this.setState('masterValve.state', open, true);
        const runTimeSeconds = this.config.masterValveDelay || 0;
        if (runTimeSeconds > 0) {
            this.log.info(`Warte ${runTimeSeconds} Sekunden Stellzeit (Kugelhahnlaufzeit) ab...`);
            await this.sleep(runTimeSeconds * 1000);
        }
        await this.setState('masterValve.isMoving', false, true);
        this.log.info(`Hauptventil hat Endlage erreicht (${open ? 'OFFEN' : 'ZU'}).`);
    }
}
if (require.main !== module) {
    module.exports = (options = {}) => new SimpleIrrigation(options);
}
else {
    (() => new SimpleIrrigation())();
}
//# sourceMappingURL=main.js.map