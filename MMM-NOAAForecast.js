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
    units: config.units,
    updateInterval: 10, // minutes
    requestDelay: 0,
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
    label_gust: "max",
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

  accumulateValueForTimestamp: function (targetTimestamp, arr) {
    if (!targetTimestamp || !Array.isArray(arr)) return undefined;
    var target = moment(targetTimestamp);
    if (!target.isValid()) return undefined;

    // accumulate values for entries whose start date equals the target date
    var targetDayStart = target.clone().startOf("day");
    var accumulation = 0;
    var foundAny = false;

    for (var i = 0; i < arr.length; i++) {
      var entry = arr[i];
      if (!entry || !entry.validTime) continue;

      var parts = entry.validTime.split("/");
      var startMoment = moment(parts[0]);
      if (!startMoment.isValid()) continue;

      // treat each matching start date as part of that day's 24h accumulation
      if (startMoment.isSame(targetDayStart, "day")) {
        var val = entry.value;
        var num = parseFloat(String(val));
        if (!isNaN(num)) {
          accumulation += num;
          foundAny = true;
        }
      }
    }
    return foundAny ? accumulation : undefined;
  },

  // Iterates array of objects with { validTime: "...", value: ... }
  // targetTimestamp can be any ISO timestamp string ("2025-08-29T22:00:00-04:00")
  findValueForTimestamp: function (targetTimestamp, arr) {
    if (!targetTimestamp || !Array.isArray(arr)) return undefined;
    var target = new Date(targetTimestamp);
    if (isNaN(target.getTime())) return undefined;

    var result = undefined;

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
            var dur = moment.duration(parts[1]);
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
    if (value === null || typeof value === "undefined") {
      return value;
    }

    var num = parseFloat(String(value));
    if (isNaN(num)) return value;

    if (toCelsius) {
      // input is Fahrenheit -> convert to Celsius, up to 1 decimal place
      var c = (num - 32) * (5 / 9);
      var rounded = Math.round(c * 10) / 10; // one decimal precision
      // return without unnecessary trailing .0 (i.e., "up to one decimal")
      return Number.isInteger(rounded)
        ? rounded.toString()
        : rounded.toString();
    }

    // input is Celsius -> convert to Fahrenheit, no decimal places
    var f = Math.round(num * (9 / 5) + 32);
    return f.toString();
  },

  convertDistance: function (val, toImperial) {
    if (val === null || typeof val === "undefined") {
      return val;
    }

    var actual = parseFloat(String(val));
    if (isNaN(actual)) {
      return actual;
    }

    // 1 inch = 25.4 mm
    var final = toImperial ? actual / 25.4 : actual * 25.4;

    // Round to two decimal places and return as string
    return (Math.round(final * 100) / 100).toString();
  },

  convertSpeed: function (val, toImperial) {
    if (val === null || typeof val === "undefined") {
      return val;
    }

    var actual = parseFloat(String(val));
    if (isNaN(actual)) {
      return actual;
    }

    // toImperial === true: input is km/h -> convert to mph
    // toImperial === false: input is mph -> convert to km/h
    var final = toImperial ? actual / 1.609344 : actual * 1.609344;

    // 0 decimals precision, return as string for consistent concatenation elsewhere
    return Math.round(final).toString();
  },

  convertIfNeeded: function (val, unit) {
    if (
      (unit === "wmoUnit:degC" || unit === "C") &&
      this.config.units === "imperial"
    ) {
      val = this.convertTemperature(val, false);
    } else if (
      (unit === "wmoUnit:degF" || unit === "F") &&
      this.config.units === "metric"
    ) {
      val = this.convertTemperature(val, true);
    } else if (unit === "wmoUnit:in" && this.config.units === "metric") {
      val = this.convertDistance(val, false);
    } else if (unit === "wmoUnit:mm" && this.config.units === "imperial") {
      val = this.convertDistance(val, true);
    } else if (unit === "wmoUnit:km_h-1" && this.config.units === "imperial") {
      val = this.convertSpeed(val, true);
    } else if (unit === "wmoUnit:km_h-1" && this.config.units === "metric") {
      val = this.convertSpeed(val, false);
    }

    return val;
  },

  // Generic helper to get a grid value for a daily entry, with possible accumulation for 24h.
  getGridValue: function (startTime, gridKey, dailyAccumulation) {
    if (
      !this.weatherData ||
      !this.weatherData.grid ||
      !this.weatherData.grid[gridKey] ||
      !Array.isArray(this.weatherData.grid[gridKey].values)
    ) {
      return undefined;
    }

    var val = dailyAccumulation
      ? this.accumulateValueForTimestamp(
          startTime,
          this.weatherData.grid[gridKey].values
        )
      : this.findValueForTimestamp(
          startTime,
          this.weatherData.grid[gridKey].values
        );

    return this.convertIfNeeded(val, this.weatherData.grid[gridKey].uom);
  },

  calculateFeelsLike: function (temp, wind, humidityPercent) {
    // temp: number (F if units !== 'metric', C if units === 'metric')
    // wind: number (mph if units !== 'metric', km/h if units === 'metric')
    // humidityPercent: number (0-100)
    var t = parseFloat(String(temp));
    var v = parseFloat(String(wind));
    var h =
      typeof humidityPercent === "number"
        ? humidityPercent
        : parseFloat(String(humidityPercent));

    if (isNaN(t)) return temp;
    if (isNaN(v)) v = 0;
    if (isNaN(h)) h = 50;

    var isMetric = this.config && this.config.units === "metric";

    // Convert metric inputs to Fahrenheit and mph for formula calculation
    var tempF = isMetric ? t * (9 / 5) + 32 : t;
    var windMph = isMetric ? v / 1.609344 : v;

    var feelsF = tempF;

    // Wind Chill applies when temp ≤ 50°F and wind ≥ 3 mph
    if (tempF <= 50 && windMph >= 3) {
      feelsF =
        35.74 +
        0.6215 * tempF -
        35.75 * Math.pow(windMph, 0.16) +
        0.4275 * tempF * Math.pow(windMph, 0.16);
    }
    // Heat Index applies when temp ≥ 80°F and humidity ≥ 40%
    else if (tempF >= 80 && h >= 40) {
      var T = tempF;
      var R = h;
      feelsF =
        -42.379 +
        2.04901523 * T +
        10.14333127 * R -
        0.22475541 * T * R -
        0.00683783 * T * T -
        0.05481717 * R * R +
        0.00122874 * T * T * R +
        0.00085282 * T * R * R -
        0.00000199 * T * T * R * R;
    }

    // Convert back to metric if needed
    var feels = isMetric ? (feelsF - 32) * (5 / 9) : feelsF;

    return Math.round(feels * 10) / 10; // one decimal place
  },

  /*
    We need to pre-process the dailies and hourly to augment the data there based on grid data.
    */
  preProcessWeatherData: function () {
    if (Array.isArray(this.weatherData.daily)) {
      // For daily, we need to augment min, max temperatures, rain, snow accumulation and gust data.
      for (var i = 0; i < this.weatherData.daily.length; i++) {
        var daily = this.weatherData.daily[i];

        daily.temperature = this.convertIfNeeded(
          daily.temperature,
          daily.temperatureUnit
        );

        daily.maxTemperature = this.getGridValue(
          this.weatherData.daily[i].startTime,
          "maxTemperature",
          true
        );

        daily.minTemperature = this.getGridValue(
          this.weatherData.daily[i].startTime,
          "minTemperature",
          true
        );

        // IMPORTANT: Commonly NOAA will only have 2-3 days out of data here, so
        // this may come out undefined even though it does provide a % chance of rain.
        daily.snowAccumulation = this.getGridValue(
          this.weatherData.daily[i].startTime,
          "iceAccumulation",
          true
        );

        // IMPORTANT: Commonly NOAA will only have 2-3 days out of data here, so
        // this may come out undefined even though it does provide a % chance of rain.
        daily.rainAccumulation = this.getGridValue(
          this.weatherData.daily[i].startTime,
          "quantitativePrecipitation",
          true
        );
      }

      // For hourly, we need to augment rain, snow accumulation and gust data.
      for (var j = 0; j < this.weatherData.hourly.length; j++) {
        var hourly = this.weatherData.hourly[j];

        hourly.temperature = this.convertIfNeeded(
          hourly.temperature,
          hourly.temperatureUnit
        );

        // IMPORTANT: Commonly NOAA will only have 2-3 days out of data here, so
        // this may come out undefined even though it does provide a % chance of rain.
        hourly.snowAccumulation = this.getGridValue(
          this.weatherData.hourly[j].startTime,
          "iceAccumulation",
          false
        );

        // IMPORTANT: Commonly NOAA will only have 2-3 days out of data here, so
        // this may come out undefined even though it does provide a % chance of rain.
        hourly.rainAccumulation = this.getGridValue(
          this.weatherData.hourly[j].startTime,
          "quantitativePrecipitation",
          false
        );

        hourly.windGust = this.getGridValue(
          this.weatherData.hourly[i].startTime,
          "windGust",
          false
        );

        hourly.feelsLike = this.calculateFeelsLike(
          hourly.temperature,
          hourly.windGust,
          hourly.relativeHumidity.value
        );
      }
    }
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
      for (i; i <= maxi * 2; i += 2) {
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
        temperature: `${Math.round(this.weatherData.hourly[0].temperature)}°`,
        feelslike: `${Math.round(this.weatherData.hourly[0].feelsLike)}°`,
        animatedIconId: this.config.useAnimatedIcons
          ? this.getAnimatedIconId()
          : null,
        animatedIconName: this.convertNOAAtoIcon(
          this.weatherData.hourly[0].icon
        ),
        iconPath: this.generateIconSrc(
          this.convertNOAAtoIcon(this.weatherData.hourly[0].icon),
          true
        ),
        tempRange: this.formatHiLowTemperature(
          this.weatherData.daily[0].maxTemperature,
          this.weatherData.daily[0].minTemperature
        ),
        precipitation: this.formatPrecipitation(
          null,
          this.weatherData.hourly[0].rainAccumulation,
          this.weatherData.hourly[0].snowAccumulation
        ),
        wind: this.formatWind(
          this.weatherData.hourly[0].windSpeed,
          this.weatherData.hourly[0].windDirection,
          this.weatherData.hourly[0].windGust
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

    // --------- Precipitation ---------
    fItem.precipitation = this.formatPrecipitation(
      fData.probabilityOfPrecipitation.value,
      fData.rainAccumulation,
      fData.snowAccumulation
    );

    // --------- Wind ---------
    fItem.wind = this.formatWind(
      fData.windSpeed,
      fData.windDirection,
      fData.windGust
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

    // --------- Precipitation ---------
    fItem.precipitation = this.formatPrecipitation(
      fData.probabilityOfPrecipitation.value,
      fData.rainAccumulation,
      fData.snowAccumulation
    );

    // --------- Wind ---------
    fItem.wind = this.formatWind(
      fData.windSpeed,
      fData.windDirection,
      fData.windGust
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
    var accumulationType = null;
    var pop = `${percentChance}%`;

    var unit = this.config.units === "imperial" ? "in" : "mm";

    if (snowAccumulation && parseFloat(snowAccumulation) > 0) {
      accumulationType = "snow";
      accumulation = `${Math.round(snowAccumulation)} ${unit}`;
    } else if (rainAccumulation && parseFloat(rainAccumulation) > 0) {
      accumulationType = "rain";
      accumulation = `${Math.round(rainAccumulation)} ${unit}`;
    }

    return {
      pop: pop,
      accumulation: accumulation,
      accumulationType: accumulationType
    };
  },

  /*
      Returns a formatted data object for wind conditions
     */
  formatWind: function (speed, bearing, gust) {
    //wind gust
    var windGust = null;

    var gustLabel = this.config.units === "imperial" ? "mph" : "km/h";

    if (!this.config.concise && gust) {
      windGust = ` (${this.config.label_gust} ${gust} ${gustLabel})`;
    }

    return {
      windSpeed: `${speed} ${!this.config.concise ? `${bearing}` : ""}`,
      windGust: windGust
    };
  },

  /*
      Some display items need the unit beside them.  This returns the correct
      unit for the given metric based on the unit set in use.
     */
  units: {
    accumulationRain: {
      imperial: "in",
      metric: "mm",
      "": "mm"
    },
    accumulationSnow: {
      imperial: "in",
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
      conditions (from which this module was originally based):

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
