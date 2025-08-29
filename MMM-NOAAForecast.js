// MMM-NOAAForecast.js
Module.register("MMM-NOAAForecast", {
  /*
      This module uses the Nunjucks templating system introduced in
      version 2.2.0 of MagicMirror.  If you're seeing nothing on your
      display where you expect this module to appear, make sure your
      MagicMirror version is at least 2.2.0.
    */
  requiresVersion: "2.2.0",

  defaults: {
    latitude: "",
    longitude: "",
    updateInterval: 10, // minutes
    requestDelay: 0,
    units: config.units,
    showCurrentConditions: true,
    showExtraCurrentConditions: true,
    showSummary: true,
    forecastHeaderText: "",
    showForecastTableColumnHeaderIcons: true,
    showHourlyForecast: true,
    hourlyForecastInterval: 3,
    maxHourliesToShow: 3,
    showDailyForecast: true,
    maxDailiesToShow: 3,
    includeTodayInDailyForecast: false,
    showPrecipitation: true,
    concise: true,
    showWind: true,
    showFeelsLike: true,
    language: config.language,
    iconset: "1c",
    mainIconset: "1c",
    useAnimatedIcons: true,
    animateMainIconOnly: true,
    colored: true,
    forecastLayout: "tiled",
    showInlineIcons: true,
    mainIconSize: 100,
    forecastTiledIconSize: 70,
    forecastTableIconSize: 30,
    updateFadeSpeed: 500,
    label_maximum: "max",
    label_high: "H",
    label_low: "L",
    label_timeFormat: "h a",
    label_days: ["Sun", "Mon", "Tue", "Wed", "Thur", "Fri", "Sat"],
    label_ordinals: [
      "N",
      "NNE",
      "NE",
      "ENE",
      "E",
      "ESE",
      "SE",
      "SSE",
      "S",
      "SSW",
      "SW",
      "WSW",
      "W",
      "WNW",
      "NW",
      "NNW"
    ],
    moduleTimestampIdPrefix: "NOAA_CALL_TIMESTAMP_"
  },

  validUnits: ["imperial", "metric", ""],
  validLayouts: ["tiled", "table"],

  getScripts: function () {
    return ["moment.js", this.file("skycons.js")];
  },

  getStyles: function () {
    return ["MMM-NOAAForecast.css"];
  },

  getTemplate: function () {
    return "MMM-NOAAForecast.njk";
  },

  /*
      Data object provided to the Nunjucks template. The template does not
      do any data minipulation; the strings provided here are displayed as-is.
      The only logic in the template are conditional blocks that determine if
      a certain section should be displayed, and simple loops for the hourly
      and daily forecast.
     */
  getTemplateData: function () {
    return {
      phrases: {
        loading: this.translate("LOADING")
      },
      loading: this.formattedWeatherData === null ? true : false,
      config: this.config,
      forecast: this.formattedWeatherData,
      inlineIcons: {
        rain: this.generateIconSrc("i-rain"),
        snow: this.generateIconSrc("i-snow"),
        wind: this.generateIconSrc("i-wind")
      },
      animatedIconSizes: {
        main: this.config.mainIconSize,
        forecast:
          this.config.forecastLayout === "tiled"
            ? this.config.forecastTiledIconSize
            : this.config.forecastTableIconSize
      },
      moduleTimestampIdPrefix: this.config.moduleTimestampIdPrefix,
      identifier: this.identifier,
      timeStamp: this.dataRefreshTimeStamp
    };
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`);

    this.weatherData = null;
    this.iconIdCounter = 0;
    this.formattedWeatherData = null;
    this.animatedIconDrawTimer = null;

    /*
          Optionally, Dark Sky's Skycons animated icon
          set can be used.  If so, it is drawn to the DOM
          and animated on demand as opposed to being
          contained in animated images such as GIFs or SVGs.
          This initializes the colours for the icons to use.
         */
    if (this.config.useAnimatedIcons) {
      // eslint-disable-next-line no-undef
      this.skycons = new Skycons({
        monochrome: false,
        colors: {
          main: "#FFFFFF",
          moon: this.config.colored ? "#FFFDC2" : "#FFFFFF",
          fog: "#FFFFFF",
          fogbank: "#FFFFFF",
          cloud: this.config.colored ? "#BEBEBE" : "#999999",
          snow: "#FFFFFF",
          leaf: this.config.colored ? "#98D24D" : "#FFFFFF",
          rain: this.config.colored ? "#7CD5FF" : "#FFFFFF",
          sun: this.config.colored ? "#FFD550" : "#FFFFFF"
        }
      });
    }

    //sanitize optional parameters
    if (this.validUnits.indexOf(this.config.units) === -1) {
      this.config.units = "imperial";
    }
    if (this.validLayouts.indexOf(this.config.forecastLayout) === -1) {
      this.config.forecastLayout = "tiled";
    }
    if (this.iconsets[this.config.iconset] === null) {
      this.config.iconset = "1c";
    }
    if (this.iconsets[this.config.mainIconset] === null) {
      this.config.mainIconset = this.config.iconset;
    }
    this.sanitizeNumbers([
      "updateInterval",
      "requestDelay",
      "hourlyForecastInterval",
      "maxHourliesToShow",
      "maxDailiesToShow",
      "mainIconSize",
      "forecastIconSize",
      "updateFadeSpeed",
      "animatedIconPlayDelay"
    ]);

    //force icon set to mono version whern config.coloured = false
    if (this.config.colored === false) {
      this.config.iconset = this.config.iconset.replace("c", "m");
    }

    //start data poll
    var self = this;
    setTimeout(function () {
      //first data pull is delayed by config
      self.getData();

      setInterval(function () {
        self.getData();
      }, self.config.updateInterval * 60 * 1000); //convert to milliseconds
    }, this.config.requestDelay);
  },

  getData: function () {
    this.sendSocketNotification("NOAA_CALL_FORECAST_GET", {
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      units: this.config.units,
      language: this.config.language,
      instanceId: this.identifier,
      requestDelay: this.config.requestDelay
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (
      notification === "NOAA_CALL_FORECAST_DATA" &&
      payload.instanceId === this.identifier
    ) {
      //clear animated icon cache
      if (this.config.useAnimatedIcons) {
        this.clearIcons();
      }

      //process weather data
      this.dataRefreshTimeStamp = moment().format("x");
      this.weatherData = {
        daily: JSON.parse(payload.payload.forecast).properties.periods,
        hourly: JSON.parse(payload.payload.forecastHourly).properties.periods,
        grid: JSON.parse(payload.payload.forecastGridData).properties
      };

      this.preProcessWeatherData();

      this.formattedWeatherData = this.processWeatherData();

      this.updateDom(this.config.updateFadeSpeed);

      //broadcast weather update
      this.sendNotification("CALL_FORECAST_WEATHER_UPDATE", payload);

      /*
              Start icon playback. We need to wait until the DOM update
              is complete before drawing and starting the icons.

              The DOM object has a timestamp embedded that we will look
              for.  If the timestamp can be found then the DOM has been
              fully updated.
            */
      if (this.config.useAnimatedIcons) {
        var self = this;
        this.animatedIconDrawTimer = setInterval(function () {
          var elToTest = document.getElementById(
            self.config.moduleTimestampIdPrefix + self.identifier
          );
          if (
            elToTest !== null &&
            elToTest.getAttribute("data-timestamp") ===
              self.dataRefreshTimeStamp
          ) {
            clearInterval(self.animatedIconDrawTimer);
            self.playIcons(self);
          }
        }, 100);
      }
    }
  },

  // Iterates array of objects with { validTime: "...", value: ... }
  // targetTimestamp can be any ISO timestamp string ("2025-08-29T22:00:00-04:00")
  findValueForTimestamp: function (targetTimestamp, arr, considerIntervals24h) {
    if (!targetTimestamp || !Array.isArray(arr)) return undefined;
    var target = new Date(targetTimestamp);
    if (isNaN(target.getTime())) return undefined;

    for (var i = 0; i < arr.length; i++) {
      var entry = arr[i];
      if (!entry || !entry.validTime) continue;

      try {
        // Handle interval where the end is an ISO duration, e.g. "2025-08-29T10:00:00-04:00/PT3H"
        var parts = entry.validTime.split("/");
        if (
          parts.length === 2 &&
          parts[1] &&
          parts[1].charAt(0).toUpperCase() === "P"
        ) {
          var startMoment = moment(parts[0]);
          if (startMoment.isValid()) {
            var dur = moment.duration(
              considerIntervals24h ? "PT24H" : parts[1]
            );
            if (dur && dur.asMilliseconds() > 0) {
              var endMoment = startMoment.clone().add(dur);
              if (
                moment(target).isSameOrAfter(startMoment) &&
                moment(target).isBefore(endMoment)
              ) {
                return entry.value;
              } else {
                // not in this entry's duration, continue to next entry
                continue;
              }
            }
          }
        }
      } catch (e) {
        // ignore parse errors and fall back to existing handling below
      }
    }
    return undefined;
  },

  convertTemperature: function (value, toCelsius) {
    if (toCelsius) {
      var fahrenheit = parseInt(String(value), 10);
      if (isNaN(fahrenheit)) return value;
      return Math.round((fahrenheit - 32) * (5 / 9));
    }

    var celsius = parseInt(String(value), 10);
    if (isNaN(celsius)) return value;
    return Math.round(celsius * (9 / 5) + 32);
  },

  // Generic helper to get a grid value for a daily entry (with 24h fallback).
  // This is awful - NOAA will provide gaps in their grid data,
  // so if we can't find the time slot, consider it a 24h and run with it. Lame.
  getGridValue: function (startTime, gridKey) {
    if (
      !this.weatherData ||
      !this.weatherData.grid ||
      !this.weatherData.grid[gridKey] ||
      !Array.isArray(this.weatherData.grid[gridKey].values)
    ) {
      return undefined;
    }

    var val = this.findValueForTimestamp(
      startTime,
      this.weatherData.grid[gridKey].values,
      false
    );

    if (typeof val === "undefined" || val === null) {
      val = this.findValueForTimestamp(
        startTime,
        this.weatherData.grid[gridKey].values,
        true
      );
    }

    if (
      this.weatherData.grid[gridKey].uom === "wmoUnit:degC" &&
      this.config.units === "imperial"
    ) {
      val = this.convertTemperature(val, false);
    } else if (
      this.weatherData.grid[gridKey].uom === "wmoUnit:degF" &&
      this.config.units === "metric"
    ) {
      val = this.convertTemperature(val, true);
    }

    return val;
  },

  /*
    We need to pre-process the dailies and hourly to augment the data there based on grid data.
    */
  preProcessWeatherData: function () {
    // For daily, we need to augment min, max temperatures, rain, snow accumulation and gust data.
    // Example usage within this method (replace `someArray` and `ts` as needed):

    if (Array.isArray(this.weatherData.daily)) {
      for (var i = 0; i < this.weatherData.daily.length; i++) {
        var entry = this.weatherData.daily[i];
        try {
          entry.maxTemperature = this.getGridValue(
            this.weatherData.daily[i].startTime,
            "maxTemperature"
          );

          entry.minTemperature = this.getGridValue(
            this.weatherData.daily[i].startTime,
            "minTemperature"
          );
        } catch (e) {
          // ignore errors
        }
      }
    }

    // For hourly, we need to augment rain, snow accumulation and gust data.
  },

  /*
      This prepares the data to be used by the Nunjucks template.  The template does not do any logic other
      if statements to determine if a certain section should be displayed, and a simple loop to go through
      the houly / daily forecast items.
    */
  processWeatherData: function () {
    var summary;
    if (this.config.concise) {
      summary = this.weatherData.daily[0].shortForecast;
    } else {
      summary = this.weatherData.daily[0].detailedForecast;
    }

    var hourlies = [];
    if (this.config.showHourlyForecast) {
      var displayCounter = 0;
      var currentIndex = this.config.hourlyForecastInterval;
      while (displayCounter < this.config.maxHourliesToShow) {
        if (this.weatherData.hourly[currentIndex] === null) {
          break;
        }

        hourlies.push(
          this.forecastHourlyFactory(
            this.weatherData.hourly[currentIndex],
            "hourly"
          )
        );

        currentIndex += this.config.hourlyForecastInterval;
        displayCounter++;
      }
    }

    var dailies = [];
    if (this.config.showDailyForecast) {
      var i = 1;
      var maxi = this.config.maxDailiesToShow;
      if (this.config.includeTodayInDailyForecast) {
        i = 0;
        maxi = this.config.maxDailiesToShow - 1;
      }
      for (i; i <= maxi; i++) {
        if (this.weatherData.daily[i] === null) {
          break;
        }

        dailies.push(
          this.forecastDailyFactory(this.weatherData.daily[i], "daily")
        );
      }
    }

    return {
      currently: {
        temperature: `${Math.round(this.weatherData.current.temp)}°`,
        feelslike: `${Math.round(this.weatherData.current.feels_like)}°`,
        animatedIconId: this.config.useAnimatedIcons
          ? this.getAnimatedIconId()
          : null,
        animatedIconName: this.convertNOAAtoIcon(
          this.weatherData.current.weather[0].icon
        ),
        iconPath: this.generateIconSrc(
          this.convertNOAAtoIcon(this.weatherData.current.weather[0].icon),
          true
        ),
        tempRange: this.formatHiLowTemperature(
          this.weatherData.daily[0].temp.max,
          this.weatherData.daily[0].temp.min
        ),
        precipitation: this.formatPrecipitation(
          null,
          this.weatherData.current.rain,
          this.weatherData.current.snow
        ),
        wind: this.formatWind(
          this.weatherData.current.wind_speed,
          this.weatherData.current.wind_deg,
          this.weatherData.current.wind_gust
        )
      },
      summary: summary,
      hourly: hourlies,
      daily: dailies
    };
  },

  forecastHourlyFactory: function (fData, type) {
    var fItem = new Object();

    // --------- Date / Time Display ---------
    //time (e.g.: "5 PM")
    fItem.time = moment(fData.startTime).format(this.config.label_timeFormat);

    // --------- Icon ---------
    if (this.config.useAnimatedIcons && !this.config.animateMainIconOnly) {
      fItem.animatedIconId = this.getAnimatedIconId();
      fItem.animatedIconName = this.convertNOAAtoIcon(fData.icon);
    }
    fItem.iconPath = this.generateIconSrc(this.convertNOAAtoIcon(fData.icon));

    // --------- Temperature ---------
    //just display projected temperature for that hour
    fItem.temperature = `${Math.round(fData.temperature)}°`;

    // TODO(MEM): what about fData.probabilityOfPrecipitation unit?
    // --------- Precipitation ---------
    fItem.precipitation = this.formatPrecipitation(
      fData.probabilityOfPrecipitation.value,
      0,
      0
      // TODO(MEM): Fix. fData.rain,
      // TODO(MEM): Fix fData.snow
    );

    // --------- Wind ---------
    fItem.wind = this.formatWind(
      fData.windSpeed,
      fData.windDirection,
      "0" // TODO(MEM));
    );

    return fItem;
  },

  forecastDailyFactory: function (fData, type) {
    var fItem = new Object();

    // --------- Date / Time Display ---------
    //day name (e.g.: "MON")
    fItem.day = this.config.label_days[moment(fData.startTime).format("d")];

    // --------- Icon ---------
    if (this.config.useAnimatedIcons && !this.config.animateMainIconOnly) {
      fItem.animatedIconId = this.getAnimatedIconId();
      fItem.animatedIconName = this.convertNOAAtoIcon(fData.icon);
    }
    fItem.iconPath = this.generateIconSrc(this.convertNOAAtoIcon(fData.icon));

    // --------- Temperature ---------
    //display High / Low temperatures
    fItem.tempRange = this.formatHiLowTemperature(
      fData.maxTemperature,
      fData.minTemperature
    );

    // TODO(MEM): what about fData.probabilityOfPrecipitation unit?
    // --------- Precipitation ---------
    fItem.precipitation = this.formatPrecipitation(
      fData.probabilityOfPrecipitation.value,
      0,
      0
      // TODO(MEM): Fix. fData.rain,
      // TODO(MEM): Fix fData.snow
    );

    // --------- Wind ---------
    fItem.wind = this.formatWind(
      fData.windDirection,
      fData.windSpeed,
      "0" // TODO(MEM)
    );

    return fItem;
  },

  /*
      Returns a formatted data object for High / Low temperature range
     */
  formatHiLowTemperature: function (h, l) {
    return {
      high: `${
        (!this.config.concise ? `${this.config.label_high} ` : "") +
        Math.round(h)
      }°`,
      low: `${
        (!this.config.concise ? `${this.config.label_low} ` : "") +
        Math.round(l)
      }°`
    };
  },

  /*
      Returns a formatted data object for precipitation
     */
  formatPrecipitation: function (
    percentChance,
    rainAccumulation,
    snowAccumulation
  ) {
    var accumulation = null;
    var accumulationtype = null;
    var pop = null;

    //accumulation
    if (snowAccumulation) {
      accumulationtype = "snow";
      if (typeof snowAccumulation === "number") {
        accumulation = `${Math.round(snowAccumulation)} ${this.getUnit(
          "accumulationSnow"
        )}`;
      } else if (
        typeof snowAccumulation === "object" &&
        snowAccumulation["1h"]
      ) {
        accumulation = `${Math.round(snowAccumulation["1h"])} ${this.getUnit(
          "accumulationSnow"
        )}`;
      }
    } else if (rainAccumulation) {
      accumulationtype = "rain";
      if (typeof rainAccumulation === "number") {
        accumulation = `${Math.round(rainAccumulation)} ${this.getUnit(
          "accumulationRain"
        )}`;
      } else if (
        typeof rainAccumulation === "object" &&
        rainAccumulation["1h"]
      ) {
        accumulation = `${Math.round(rainAccumulation["1h"])} ${this.getUnit(
          "accumulationRain"
        )}`;
      }
    }

    if (percentChance) {
      pop = `${percentChance}%`;
    }

    return {
      pop: pop,
      accumulation: accumulation,
      accumulationtype: accumulationtype
    };
  },

  /*
      Returns a formatted data object for wind conditions
     */
  formatWind: function (speed, bearing, gust) {
    //wind gust
    var windGust = null;
    if (!this.config.concise && gust) {
      windGust = ` (${this.config.label_maximum} ${gust})`;
    }

    return {
      windSpeed: `${speed} ${!this.config.concise ? `${bearing}` : ""}`,
      windGust: windGust
    };
  },

  /*
      Returns the units in use for the data pull from OpenWeather
     */
  getUnit: function (metric) {
    return this.units[metric][this.config.units];
  },

  /*
      Formats the wind direction into common ordinals (e.g.: NE, WSW, etc.)
      Wind direction is provided in degress from North in the data feed.
     */
  getOrdinal: function (bearing) {
    return this.config.label_ordinals[Math.round((bearing * 16) / 360) % 16];
  },

  /*
      Some display items need the unit beside them.  This returns the correct
      unit for the given metric based on the unit set in use.
     */
  units: {
    accumulationRain: {
      imperial: "mm",
      metric: "mm",
      "": "mm"
    },
    accumulationSnow: {
      imperial: "mm",
      metric: "mm",
      "": "mm"
    },
    windSpeed: {
      imperial: "mph",
      metric: "m/s",
      "": "m/s"
    }
  },

  /*
      Icon sets can be added here.  The path is relative to
      MagicMirror/modules/MMM-NOAAForecast/icons, and the format
      is specified here so that you can use icons in any format
      that works for you.

      OpenWeatherMap currently specifies one of ten icons for weather
      conditions:

        clear-day
        clear-night
        cloudy
        fog
        partly-cloudy-day
        partly-cloudy-night
        rain
        sleet
        snow
        wind

      All of the icon sets below support these ten plus an
      additional three in anticipation of OpenWeatherMap enabling
      a few more:

        hail,
        thunderstorm,
        tornado

      Lastly, the icons also contain three icons for use as inline
      indicators beside precipitation and wind conditions. These
      ones look best if designed to a 24px X 24px artboard.

        i-rain
        i-snow
        i-wind

     */
  iconsets: {
    "1m": { path: "1m", format: "svg" },
    "1c": { path: "1c", format: "svg" },
    "2m": { path: "2m", format: "svg" },
    "2c": { path: "2c", format: "svg" },
    "3m": { path: "3m", format: "svg" },
    "3c": { path: "3c", format: "svg" },
    "4m": { path: "4m", format: "svg" },
    "4c": { path: "4c", format: "svg" },
    "5m": { path: "5m", format: "svg" },
    "5c": { path: "5c", format: "svg" },
    "6fa": { path: "6fa", format: "svg" },
    "6oa": { path: "6oa", format: "svg" }
  },

  /*
      This converts NOAA icons to icon names

      Reference: https://github.com/weather-gov/weather.gov/blob/main/docs/icons.md and https://api.weather.gov/icons.
    */
  convertNOAAtoIcon: function (icon) {
    // If the icon string contains any of these NOAA short-codes, return the human-readable description.
    var noaaDescriptions = {
      skc: "clear",
      few: "partly-cloudy",
      sct: "partly-cloudy",
      bkn: "cloudy",
      ovc: "cloudy",
      wind_skc: "clear",
      wind_few: "partly-cloudy",
      wind_sct: "partly-cloudy",
      wind_bkn: "cloudy",
      wind_ovc: "cloudy",
      snow: "snow",
      rain_snow: "snow",
      rain_sleet: "sleet",
      snow_sleet: "snow",
      fzra: "Freezing rain",
      rain_fzra: "rain",
      snow_fzra: "snow",
      sleet: "sleet",
      rain: "rain",
      rain_showers: "rain",
      rain_showers_hi: "rain",
      tsra: "thunderstorm",
      tsra_sct: "thunderstorm",
      tsra_hi: "thunderstorm",
      tornado: "tornado",
      hurricane: "tornado",
      tropical_storm: "storm",
      dust: "fog",
      smoke: "fog",
      haze: "fog",
      hot: "clear",
      cold: "clear",
      blizzard: "snow",
      fog: "fog"
    };

    if (typeof icon === "string") {
      for (var key in noaaDescriptions) {
        if (Object.prototype.hasOwnProperty.call(noaaDescriptions, key)) {
          if (icon.indexOf(key) !== -1) {
            if (noaaDescriptions[key] === "clear") {
              if (icon.indexOf("night") !== -1) {
                return "clear-night";
              } else {
                return "clear-day";
              }
            } else if (noaaDescriptions[key] === "partly-cloudy") {
              if (icon.indexOf("night") !== -1) {
                return "partly-cloudy-night";
              } else {
                return "partly-cloudy-day";
              }
            } else {
              return noaaDescriptions[key];
            }
          }
        }
      }
    }
  },

  /*
      This generates a URL to the icon file
     */
  generateIconSrc: function (icon, mainIcon) {
    if (mainIcon) {
      return this.file(
        `icons/${this.iconsets[this.config.mainIconset].path}/${icon}.${
          this.iconsets[this.config.mainIconset].format
        }`
      );
    }
    return this.file(
      `icons/${this.iconsets[this.config.iconset].path}/${icon}.${
        this.iconsets[this.config.iconset].format
      }`
    );
  },

  /*
      When the Skycons animated set is in use, the icons need
      to be rebuilt with each data refresh.  This traverses the
      DOM to find all of the current animated icon canvas elements
      and removes them by id from the skycons object.
     */
  clearIcons: function () {
    this.skycons.pause();
    var self = this;
    var animatedIconCanvases = document.querySelectorAll(
      `.skycon-${this.identifier}`
    );
    animatedIconCanvases.forEach(function (icon) {
      self.skycons.remove(icon.id);
    });
    this.iconIdCounter = 0;
  },

  /*
      When the Skycons animated set is in use, the icons need
      to be rebuilt with each data refresh.  This returns a
      unique id that will be assigned the icon's canvas element.
     */
  getAnimatedIconId: function () {
    //id to use for the canvas element
    var iconId = `skycon_${this.identifier}_${this.iconIdCounter}`;
    this.iconIdCounter++;
    return iconId;
  },

  /*
      For use with the Skycons animated icon set. Once the
      DOM is updated, the icons are built and set to animate.
      Name is a bit misleading. We needed to wait until
      the canvas elements got added to the DOM, which doesn't
      happen until after updateDom() finishes executing
      before actually drawing the icons.

      This routine traverses the DOM for all canavas elements
      prepared for an animated icon, and adds the icon to the
      skycons object.  Then the icons are played.
    */
  playIcons: function (inst) {
    var animatedIconCanvases = document.querySelectorAll(
      `.skycon-${inst.identifier}`
    );
    animatedIconCanvases.forEach(function (icon) {
      inst.skycons.add(icon.id, icon.getAttribute("data-animated-icon-name"));
    });
    inst.skycons.play();
  },

  /*
      For any config parameters that are expected as integers, this
      routine ensures they are numbers, and if they cannot be
      converted to integers, then the module defaults are used.
     */
  sanitizeNumbers: function (keys) {
    var self = this;
    keys.forEach(function (key) {
      if (isNaN(parseInt(self.config[key]))) {
        self.config[key] = self.defaults[key];
      } else {
        self.config[key] = parseInt(self.config[key]);
      }
    });
  }
});
