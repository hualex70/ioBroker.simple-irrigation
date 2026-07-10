![Logo](admin/simple-irrigation.png)
# ioBroker.simple-irrigation

[![NPM version](https://img.shields.io/npm/v/iobroker.simple-irrigation.svg)](https://www.npmjs.com/package/iobroker.simple-irrigation)
[![Downloads](https://img.shields.io/npm/dm/iobroker.simple-irrigation.svg)](https://www.npmjs.com/package/iobroker.simple-irrigation)
![Number of Installations](https://iobroker.live/badges/simple-irrigation-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/simple-irrigation-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.simple-irrigation.png?downloads=true)](https://nodei.co/npm/iobroker.simple-irrigation/)

**Tests:** ![Test and Release](https://github.com/hualex/ioBroker.simple-irrigation/workflows/Test%20and%20Release/badge.svg)

## Simple zone-based irrigation control for ioBroker

This adapter enables flexible, zone-based control of garden irrigation valves. The configuration connects physical hardware (e.g., wireless relays, Zigbee, or Homematic actuators) with virtual control data points, making it perfectly suited for integration into any VIS visualization.

### Core Features
* **Real-time Adjustment:** Irrigation duration and flow rates can be modified on the fly via ioBroker objects without requiring an adapter restart.
* **Integrated Hardware Protection (Emergency Stop):** On every adapter restart or following a power failure, all configured hardware valves as well as the optional master valve are automatically closed.
* **Consumption Calculator:** Automated tracking of water consumption per minute, per irrigation cycle, and per week.
* **Automatic Timer:** Full-featured schedule control via cron job based on freely selectable days of the week.
* **History Log:** Integrated event history storing the last 20 system actions, optimized as a compact JSON string for visualizations.
* **Manual Zone Start:** Each zone can be controlled individually outside of the automatic irrigation sequence.
* **Optional Master Valve:** Support for a main valve including valve operating/travel time configuration.
* **Optional Rain Sensor:** Rain sensor support to temporarily interrupt or skip the irrigation sequence.
* **Irrigation Sequence Pause:** Pause function for the active irrigation sequence (e.g., if a booster pump with an intermediate buffer tank is used and the tank runs empty, this pause function can be utilized while the tank refills).

---

## Operation & Data Points (VIS Integration)

Since the control system runs autonomously via ioBroker objects, the following states can be read and written directly within your VIS visualization:

### Global Control (`autoTimer.*`)
* `autoTimer.enabled`: Activates or deactivates the automatic schedule.
* `autoTimer.abort`: A button to immediately and completely cancel an active irrigation cycle.
* `autoTimer.isPaused`: Pauses the current irrigation cycle (e.g., in case of an empty cistern or an empty booster pump buffer tank).
* `autoTimer.startMinute`: Start time (minute) of the automatic function.
* `autoTimer.startHour`: Start time (hour) of the automatic function.
* `autoTimer.days.monday ... sunday`: Active weekdays for the automatic function.

### Event Log (`history.log`)
* `history.log`: Stores the last 20 events of the control system.

### Zone Control (`zone_X_*`)
Each configured zone receives its own folder in the object tree:
* `zone_X.duration`: The desired irrigation duration in minutes (Default: `15`).
* `zone_X.litersPerMin`: The water consumption per minute for precise volume calculation (Default: `10`).
* `zone_X.active`: Switches the zone manually on (`true`) or off (`false`).
* `zone_X.enabled`: Enables or disables the respective zone (`true` or `false`).
* `zone_X.remainingSeconds`: Displays the live remaining runtime of the current zone.

### Rain Sensor (optional) (`rainSensor.*`)
If an optional rain sensor is configured, the following objects are created:
* `rainSensor.use`: Include the rain sensor in the irrigation sequence (Default: `true`).
* `rainSensor.invert`: Invert the rain sensor logic (Default: `false`).
* `rainSensor.isBypassedByRain`: Read-only; if `true`, the irrigation sequence will not be executed or will be interrupted.

### Master Valve (optional) (`masterValve.*`)
If an optional main water valve is configured, the following objects are created:
* `masterValve.state`: Current state of the master valve; can also be controlled directly.
* `masterValve.isMoving`: If a valve operating/travel delay time is specified in the adapter settings, it will be considered and indicated via this object.

---

## Changelog
### 1.0.0 (2026-07-10)
* (hualex70) initial release

### 0.0.1 (2026-07-08)
* (hualex70) some minor bugfixes 
* (hualex70) optimized object structure for restart-free VIS live updates
* (hualex70) added automatic hardware safety loop on startup (fail-safe protection)
* (hualex70) limited history log to 20 datasets for database performance

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