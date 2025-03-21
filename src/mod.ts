import { DependencyContainer } from "tsyringe";
import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { JsonUtil } from "@spt/utils/JsonUtil";
import { FileSystemSync } from "@spt/utils/FileSystemSync";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { Item } from "@spt/models/eft/common/tables/IItem";
import * as path from "path";

class MagazineManagementSystem implements IPostDBLoadMod {
  private logger: ILogger | null = null;
  private config: {
    "ammo.loadspeed": number;
    "ammo.unloadspeed": number;
    "min.MagazineSize": number;
    "max.MagazineSize": number;
    "useGlobalTimes": boolean;
    "baseLoadTime": number;
    "baseUnloadTime": number;
    "DisableMagazineAmmoLoadPenalty": boolean;
    "Resize3to2SlotMagazine": boolean;
    debug: boolean;
  } | null = null;
  private readonly configPath = path.resolve(__dirname, "../config/config.jsonc");
  private readonly defaultConfig = {
    "ammo.loadspeed": 0.85,
    "ammo.unloadspeed": 0.3,
    "min.MagazineSize": 10,
    "max.MagazineSize": 60,
    "useGlobalTimes": false,
    "baseLoadTime": 0.85,
    "baseUnloadTime": 0.3,
    "DisableMagazineAmmoLoadPenalty": false,
    "Resize3to2SlotMagazine": false,
    debug: false
  };

  public async postDBLoad(container: DependencyContainer): Promise<void> {
    if (!container) {
      console.error("[MMS] Dependency container is null. Aborting.");
      return;
    }

    this.logger = container.resolve<ILogger>("WinstonLogger");
    if (!this.logger) {
      console.error("[MMS] Logger resolution failed. Aborting.");
      return;
    }

    const jsonUtil = container.resolve<JsonUtil>("JsonUtil");
    const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
    const fileSystemSync = container.resolve<FileSystemSync>("FileSystemSync");

    if (!jsonUtil || !databaseServer || !fileSystemSync) {
      this.logger.error("[MMS] Dependency resolution failed (JsonUtil, DatabaseServer, or FileSystemSync). Aborting.");
      return;
    }

    const [configLoaded, isDefaultConfigCreated] = this.loadOrCreateConfig(jsonUtil, fileSystemSync);
    if (!configLoaded) {
      this.logger.error("[MMS] Config failed to load. Aborting.");
      return;
    }

    this.validateConfig(isDefaultConfigCreated);

    this.logger.info("[MMS] Loading database...");
    const maxRetries = 5;
    const retryDelayMs = 1000;
    let tables: ReturnType<DatabaseServer["getTables"]>;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      tables = databaseServer.getTables();
      if (tables) {
        this.logger.info(`[MMS] Database loaded in ${Date.now() - startTime}ms on attempt ${attempt}.`);
        break;
      }
      this.logger.warning(`[MMS] Database null on attempt ${attempt}/${maxRetries}. Retrying in ${retryDelayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }

    if (!tables) {
      this.logger.error(`[MMS] Database failed after ${maxRetries} attempts (${Date.now() - startTime}ms). Aborting.`);
      return;
    }

    const items = tables.templates?.items;
    if (!items) {
      this.logger.error("[MMS] Templates.items is null. Aborting adjustments.");
      return;
    }

    if (this.config!.useGlobalTimes) {
      this.adjustGlobalTimes(tables);
    } else {
      this.adjustMagazineSpeeds(items);
    }
    if (this.config!.DisableMagazineAmmoLoadPenalty) this.adjustLoadPenalty(items);
    if (this.config!.Resize3to2SlotMagazine) this.resizeMagazines(items);

    this.logger.success("[MMS] All adjustments completed.");
  }

  private loadOrCreateConfig(jsonUtil: JsonUtil, fileSystemSync: FileSystemSync): [boolean, boolean] {
    let isDefaultConfigCreated = false;

    try {
      const configDir = path.dirname(this.configPath);

      if (!existsSync(configDir)) {
        require("fs").mkdirSync(configDir, { recursive: true });
        this.logger.info("[MMS] Config directory created.");
      }

      if (!existsSync(this.configPath)) {
        this.logger.info("[MMS] Config file not found. Creating default.");
        const configContent = JSON.stringify(this.defaultConfig, null, 2) +
          "\n// Default config created. Adjust values as needed.\n" +
          "// ammo.loadspeed and ammo.unloadspeed: 0 to 1,\n" +
		  "// min.MagazineSize: -1, 2-60,\n" +
		  "// max.MagazineSize: -1, 10-100\n" +
          "// useGlobalTimes: true for global times, false for per-magazine\n" +
          "// baseLoadTime and baseUnloadTime: 0.01 to 1, 2 decimals\n" +
          "// DisableMagazineAmmoLoadPenalty: true to set LoadUnloadModifier to 0\n" +
          "// Resize3to2SlotMagazine: true to resize 3x1 magazines to 2x1\n" +
		  "// Vanilla Timings are 0.85 (baseLoadTime) and 0.3 (baseUnloadTime)";
        writeFileSync(this.configPath, configContent, "utf-8");
        this.config = { ...this.defaultConfig };
        isDefaultConfigCreated = true;
        return [true, isDefaultConfigCreated];
      }

      const fileContent = readFileSync(this.configPath, "utf-8");
      if (!fileContent || !fileContent.trim()) {
        this.logger.warning("[MMS] Config file empty or invalid.");
        this.config = null;
        return [false, isDefaultConfigCreated];
      }

      const jsonString = fileContent.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      this.config = JSON.parse(jsonString);
      this.logger.info("[MMS] Config loaded from file.");
      return [true, isDefaultConfigCreated];
    } catch (error) {
      this.logger.error(`[MMS] Config error: ${error.message}`);
      this.config = null;
      return [false, isDefaultConfigCreated];
    }
  }

  private validateConfig(isDefaultConfigCreated: boolean): void {
    if (!this.config) {
      this.logger.error("[MMS] Config is null post-load.");
      return;
    }

    // Store the original config for comparison (deep copy to avoid mutation)
    const originalConfig = JSON.parse(JSON.stringify(this.config));
    let warnings: string[] = [];

    if (this.config["ammo.loadspeed"] === undefined) warnings.push("ammo.loadspeed"), this.config["ammo.loadspeed"] = 0.85;
    if (this.config["ammo.unloadspeed"] === undefined) warnings.push("ammo.unloadspeed"), this.config["ammo.unloadspeed"] = 0.3;
    if (this.config["min.MagazineSize"] === undefined) warnings.push("min.MagazineSize"), this.config["min.MagazineSize"] = 10;
    if (this.config["max.MagazineSize"] === undefined) warnings.push("max.MagazineSize"), this.config["max.MagazineSize"] = 60;
    if (this.config["useGlobalTimes"] === undefined) warnings.push("useGlobalTimes"), this.config["useGlobalTimes"] = false;
    if (this.config["baseLoadTime"] === undefined) warnings.push("baseLoadTime"), this.config["baseLoadTime"] = 0.85;
    if (this.config["baseUnloadTime"] === undefined) warnings.push("baseUnloadTime"), this.config["baseUnloadTime"] = 0.3;
    if (this.config["DisableMagazineAmmoLoadPenalty"] === undefined) warnings.push("DisableMagazineAmmoLoadPenalty"), this.config["DisableMagazineAmmoLoadPenalty"] = false;
    if (this.config["Resize3to2SlotMagazine"] === undefined) warnings.push("Resize3to2SlotMagazine"), this.config["Resize3to2SlotMagazine"] = false;
    if (this.config.debug === undefined) warnings.push("debug"), this.config.debug = false;

    if (!this.config.useGlobalTimes) {
      let loadSpeed = typeof this.config["ammo.loadspeed"] === "string" ? parseFloat(this.config["ammo.loadspeed"].replace(",", ".")) : this.config["ammo.loadspeed"];
      if (typeof loadSpeed !== "number" || isNaN(loadSpeed) || loadSpeed < 0 || loadSpeed > 1) warnings.push("ammo.loadspeed invalid"), this.config["ammo.loadspeed"] = 1;
      else this.config["ammo.loadspeed"] = Math.round(loadSpeed * 100) / 100;

      let unloadSpeed = typeof this.config["ammo.unloadspeed"] === "string" ? parseFloat(this.config["ammo.unloadspeed"].replace(",", ".")) : this.config["ammo.unloadspeed"];
      if (typeof unloadSpeed !== "number" || isNaN(unloadSpeed) || unloadSpeed < 0 || unloadSpeed > 1) warnings.push("ammo.unloadspeed invalid"), this.config["ammo.unloadspeed"] = 1;
      else this.config["ammo.unloadspeed"] = Math.round(unloadSpeed * 100) / 100;

      if (typeof this.config["min.MagazineSize"] !== "number" || (this.config["min.MagazineSize"] !== -1 && (this.config["min.MagazineSize"] < 2 || this.config["min.MagazineSize"] > 60)))
        warnings.push("min.MagazineSize invalid"), this.config["min.MagazineSize"] = 10;

      if (typeof this.config["max.MagazineSize"] !== "number" || (this.config["max.MagazineSize"] !== -1 && (this.config["max.MagazineSize"] < 10 || this.config["max.MagazineSize"] > 100)))
        warnings.push("max.MagazineSize invalid"), this.config["max.MagazineSize"] = -1;
      else if (this.config["max.MagazineSize"] !== -1 && this.config["max.MagazineSize"] < this.config["min.MagazineSize"])
        warnings.push("max.MagazineSize < min"), this.config["max.MagazineSize"] = -1;
    }

    if (typeof this.config.useGlobalTimes !== "boolean") warnings.push("useGlobalTimes invalid"), this.config.useGlobalTimes = false;
    if (this.config.useGlobalTimes) {
      let baseLoadTime = typeof this.config["baseLoadTime"] === "string" ? parseFloat(this.config["baseLoadTime"].replace(",", ".")) : this.config["baseLoadTime"];
      if (typeof baseLoadTime !== "number" || isNaN(baseLoadTime) || baseLoadTime < 0.01 || baseLoadTime > 1) warnings.push("baseLoadTime invalid"), this.config["baseLoadTime"] = 0.85;
      else this.config["baseLoadTime"] = Math.round(baseLoadTime * 100) / 100;

      let baseUnloadTime = typeof this.config["baseUnloadTime"] === "string" ? parseFloat(this.config["baseUnloadTime"].replace(",", ".")) : this.config["baseUnloadTime"];
      if (typeof baseUnloadTime !== "number" || isNaN(baseUnloadTime) || baseUnloadTime < 0.01 || baseUnloadTime > 1) warnings.push("baseUnloadTime invalid"), this.config["baseUnloadTime"] = 0.3;
      else this.config["baseUnloadTime"] = Math.round(baseUnloadTime * 100) / 100;
    }

    if (typeof this.config.DisableMagazineAmmoLoadPenalty !== "boolean") warnings.push("DisableMagazineAmmoLoadPenalty invalid"), this.config.DisableMagazineAmmoLoadPenalty = false;
    if (typeof this.config.Resize3to2SlotMagazine !== "boolean") warnings.push("Resize3to2SlotMagazine invalid"), this.config.Resize3to2SlotMagazine = false;
    if (typeof this.config.debug !== "boolean") warnings.push("debug invalid"), this.config.debug = false;

    if (warnings.length > 0) {
      this.logger.warning(`[MMS] Config issues: ${warnings.join(", ")} - defaults applied`);
      if (!isDefaultConfigCreated) {
        try {
          const configContent = JSON.stringify(this.config, null, 2) + "\n// Updated with validated values\n// See initial comments for details";
          writeFileSync(this.configPath, configContent, "utf-8");
          this.logger.info("[MMS] Config validated and written back due to changes.");
        } catch (error) {
          this.logger.error(`[MMS] Config write-back failed: ${error.message}`);
        }
      } else {
        this.logger.info("[MMS] Default config created; no write-back.");
      }
    } else {
      // Compare original and validated config to detect comment-only differences
      const originalConfigStr = JSON.stringify(originalConfig);
      const validatedConfigStr = JSON.stringify(this.config);
      if (originalConfigStr === validatedConfigStr) {
        this.logger.info("[MMS] Config validated; no changes needed.");
      } else {
        this.logger.info("[MMS] Config validated; only comment differences detected, skipping write-back.");
      }
    }
  }

  private adjustMagazineSpeeds(dbItems: { [key: string]: Item }): void {
    if (!dbItems) {
      this.logger.error("[MMS] Items null in adjustMagazineSpeeds.");
      return;
    }

    for (const item in dbItems) {
      if (dbItems[item]._parent === "5448bc234bdc2d3c308b4569") {
        const itemProps = dbItems[item]._props;
        if (!itemProps || !itemProps.Cartridges) {
          if (this.config!.debug) this.logger.warning(`[MMS] Skipping ${item}: no props or cartridges`);
          continue;
        }

        const cartridge = itemProps.Cartridges[0];
        const magSize = cartridge._max_count ?? 0;
        if (magSize === 0) {
          if (this.config!.debug) this.logger.warning(`[MMS] Skipping ${item}: invalid size`);
          continue;
        }

        const effectiveMin = this.config!["min.MagazineSize"] === -1 ? 2 : this.config!["min.MagazineSize"];
        if (magSize >= effectiveMin && (this.config!["max.MagazineSize"] === -1 || magSize <= this.config!["max.MagazineSize"])) {
          itemProps.CheckOverride = this.config!["ammo.unloadspeed"] * 100;
          if (this.config!.debug) {
            this.logger.info(`[MMS] Adjusted ${dbItems[item]._name ?? item}: CheckOverride=${itemProps.CheckOverride}`);
          }
        }
      }
    }
  }

  private adjustLoadPenalty(dbItems: { [key: string]: Item }): void {
    if (!dbItems) {
      this.logger.error("[MMS] Items null in adjustLoadPenalty.");
      return;
    }

    for (const item in dbItems) {
      if (dbItems[item]._parent === "5448bc234bdc2d3c308b4569") {
        const itemProps = dbItems[item]._props;
        if (!itemProps || !itemProps.Cartridges) {
          if (this.config!.debug) this.logger.warning(`[MMS] Skipping ${item}: no props or cartridges`);
          continue;
        }

        const oldModifier = itemProps.LoadUnloadModifier;
        if (this.config!.DisableMagazineAmmoLoadPenalty) {
          itemProps.LoadUnloadModifier = 0;
        } else if (oldModifier !== 1) {
          itemProps.LoadUnloadModifier = 1;
        }

        if (this.config!.debug && oldModifier !== itemProps.LoadUnloadModifier) {
          this.logger.info(`[MMS] Adjusted ${dbItems[item]._name ?? item}: LoadUnloadModifier=${itemProps.LoadUnloadModifier}`);
        }
      }
    }
  }

  private resizeMagazines(dbItems: { [key: string]: Item }): void {
    if (!dbItems) {
      this.logger.error("[MMS] Items null in resizeMagazines.");
      return;
    }

    for (const item in dbItems) {
      if (dbItems[item]._parent === "5448bc234bdc2d3c308b4569") {
        const itemProps = dbItems[item]._props;
        if (!itemProps || !itemProps.Cartridges) {
          if (this.config!.debug) this.logger.warning(`[MMS] Skipping ${item}: no props or cartridges`);
          continue;
        }

        if (itemProps.Height === 3 && itemProps.Width === 1) {
          itemProps.Height = 2;
          if (this.config!.debug) {
            this.logger.info(`[MMS] Resized ${dbItems[item]._name ?? item}: Height=${itemProps.Height}, Width=${itemProps.Width}`);
          }
        }
      }
    }
  }

  private adjustGlobalTimes(tables: ReturnType<DatabaseServer["getTables"]>): void {
    if (!tables.globals?.config?.SkillsSettings?.Reloading) {
      const needsAdjustment = this.config!.useGlobalTimes && (
        tables.globals?.config?.SkillsSettings?.Reloading?.BaseLoadTime !== this.config!["baseLoadTime"] ||
        tables.globals?.config?.SkillsSettings?.Reloading?.BaseUnloadTime !== this.config!["baseUnloadTime"]
      );
      if (needsAdjustment || this.config!.debug) {
        this.logger.error("[MMS] Globals or Reloading settings null; skipping global time adjustments.");
      }
      return;
    }

    const reloadingSettings = tables.globals.config.SkillsSettings.Reloading;
    const changes = [];
    if (reloadingSettings.BaseLoadTime !== this.config!["baseLoadTime"]) {
      changes.push(`BaseLoadTime=${reloadingSettings.BaseLoadTime}->${this.config!["baseLoadTime"]}`);
      reloadingSettings.BaseLoadTime = this.config!["baseLoadTime"];
    }
    if (reloadingSettings.BaseUnloadTime !== this.config!["baseUnloadTime"]) {
      changes.push(`BaseUnloadTime=${reloadingSettings.BaseUnloadTime}->${this.config!["baseUnloadTime"]}`);
      reloadingSettings.BaseUnloadTime = this.config!["baseUnloadTime"];
    }

    if (this.config!.debug && changes.length > 0) {
      this.logger.info(`[MMS] Global times adjusted: ${changes.join(", ")}`);
    }
  }
}

module.exports = { mod: new MagazineManagementSystem() };
