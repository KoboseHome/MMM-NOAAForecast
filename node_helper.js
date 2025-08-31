/*********************************

  Node Helper for MMM-NOAAForecast.

  This helper is responsible for the DarkSky-compatible data pull from NOAA.

  Sample API:

    e.g. https://api.weather.gov/points/40.8932469,-74.0116536

*********************************/

var NodeHelper = require("node_helper");
var needle = require("needle");
var moment = require("moment");

module.exports = NodeHelper.create({
  start: function () {
    console.log(
      `====================== Starting node_helper for module [${this.name}]`
    );
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "NOAA_CALL_FORECAST_GET") {
      var self = this;
      // use a browser-like User-Agent for requests
      var needleOptions = {
        follow_max: 3,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "application/geo+json"
        }
      };

      if (
        payload.latitude === null ||
        payload.latitude === "" ||
        payload.longitude === null ||
        payload.longitude === ""
      ) {
        console.log(
          `[MMM-NOAAForecast] ${moment().format(
            "D-MMM-YY HH:mm"
          )} ** ERROR ** Latitude and/or longitude not provided.`
        );
      } else {
        var url = `https://api.weather.gov/points/${payload.latitude},${payload.longitude}`;

        console.log(`[MMM-NOAAForecast] Getting data: ${url}`);
        needle.get(url, needleOptions, function (error, response, body) {
          if (!error && response.statusCode === 200) {
            var forecastData = {};
            var parsedBody = typeof body === "string" ? JSON.parse(body) : body;
            var properties = parsedBody.properties;

            if (
              properties &&
              properties.forecast &&
              properties.forecastHourly /* && properties.forecastGridData */
            ) {
              var forecastUrls = [
                { key: "forecast", url: properties.forecast },
                { key: "forecastHourly", url: properties.forecastHourly },
                { key: "forecastGridData", url: properties.forecastGridData }
              ];

              var completedRequests = 0;

              forecastUrls.forEach(function (item) {
                needle.get(item.url, needleOptions, function (err, res, data) {
                  if (!err && res.statusCode === 200) {
                    forecastData[item.key] = data;
                    console.log(`[MMM-NOAAForecast] Getting data: ${item.url}`);
                  } else {
                    console.log(
                      `[MMM-NOAAForecast] ${moment().format(
                        "D-MMM-YY HH:mm"
                      )} ** ERROR ** Failed to get ${item.key}: ${err}`
                    );
                  }

                  completedRequests++;
                  if (completedRequests === forecastUrls.length) {
                    self.sendSocketNotification("NOAA_CALL_FORECAST_DATA", {
                      instanceId: payload.instanceId,
                      payload: forecastData
                    });
                  }
                });
              });
            } else {
              console.log(
                `[MMM-NOAAForecast] ${moment().format(
                  "D-MMM-YY HH:mm"
                )} ** ERROR ** Missing forecast URLs in response: ${
                  error ? error : JSON.stringify(parsedBody)
                }`
              );
            }
          } else {
            console.log(
              `[MMM-NOAAForecast] ${moment().format(
                "D-MMM-YY HH:mm"
              )} ** ERROR ** ${error}`
            );
          }
        });
      }
    }
  }
});
