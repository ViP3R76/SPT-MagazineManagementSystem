# Magazine Management System

A server-sided mod for Single Player Tarkov (SPT) 3.11.

## Features
- "Should" work on FIKA Installations
- Adjust magazine load-/unload speeds individually or globally.
- Optionally disable ammo load/unload penalties.
- Resize 3x1 magazines to 2x1 for better inventory management.
- Config validation with defaults applied automatically.
- Minimal console output; detailed logs with `debug: true`.

## Installation (Server)
1. Ensure SPT 3.11 is installed.
2. Copy the `MagazineManagementSystem` folder to `user/mods/`.
3. Start your SPT server.

## Configuration
Be sure to load this mod AFTER other mods that maybe change the same settings. (e.g. change load order)
Edit `config/config.jsonc` in the mod folder. A default config is created on first run if absent.

### Config Options
```jsonc
{
  "ammo.loadspeed": 0.5,          // Load speed multiplier (0 to 1); unused if useGlobalTimes is true
  "ammo.unloadspeed": 0.5,        // Unload speed multiplier (0 to 1); applied via CheckOverride
  "min.MagazineSize": 10,         // Minimum magazine capacity to adjust (2 to 60, or -1 for no min)
  "max.MagazineSize": 60,         // Maximum magazine capacity to adjust (10 to 100, or -1 for no max)
  "useGlobalTimes": false,        // True: use baseLoadTime/baseUnloadTime globally; False: per-magazine speeds
  "baseLoadTime": 0.85,           // Global load time (0.01 to 1, 2 decimals); used if useGlobalTimes is true
  "baseUnloadTime": 0.3,          // Global unload time (0.01 to 1, 2 decimals); used if useGlobalTimes is true
  "DisableMagazineAmmoLoadPenalty": false, // True: sets LoadUnloadModifier to 0; False: ensures it’s 1
  "Resize3to2SlotMagazine": false, // True: resizes 3x1 magazines to 2x1
  "debug": false                  // True: enables detailed logging
}
```
## Requirements (Client) - only if Resize3to2SlotMagazine is used (!)
1. Start your SPT Launcher
2. Open Settings
3. Clean temp files

---
## Changelog
1.0.1
- **Bugfix**: Changed default config-generation settings
- **Bugfix**: Forgot to change the sizedown on 3-2 slot conversion for inventory optic of the weapon
- **Note**: Pushed to the HUB for downloads
1.0.0
- **Features**: Updated to include all current capabilities (split functions, logging, config logic).
- **Configuration**: Matches the exact options and defaults from `src/mod.ts`, with concise descriptions.
- **Logging**: Documented the minimalistic approach and debug toggle.
- **Installation**: Kept generic but added a note about dependencies.
- **Features**: speed adjustments, load penalty toggle, magazine resizing, minimal logging.
- **Initial release for SPT 3.11.x**

## Troubleshooting
    Enable debug: true in config.jsonc and check logs in user/logs/.
    Ensure SPT 3.11 is used and npm run build is run before starting the server.

## License
MIT License
Copyright (c) 2025 ViP3R_76

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
