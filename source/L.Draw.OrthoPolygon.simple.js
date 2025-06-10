/**
 * L.Draw.OrthoPolygon.simple.js
 * A minimal version to test the core handler and map click functionality.
 */
(function (window, document, L, undefined) {
  "use strict";

  if (!L.Draw) L.Draw = {};

  L.Draw.OrthoPolygonSimple = L.Handler.extend({
    includes: L.Evented.prototype,

    initialize: function (map, options) {
      L.Handler.prototype.initialize.call(this, map);
      L.Util.setOptions(this, options);
      this._enabled = false;
      console.log("Simple Handler Initialized");
    },

    addHooks: function () {
      if (this._map) {
        console.log("Adding hooks: Attaching map click listener...");
        this._map.on("click", this._onMapClick, this);
        this._map.getContainer().style.cursor = "crosshair";
        this._enabled = true;
        console.log("Hooks added. Drawing mode should be active.");
        this.fire("enabled");
      } else {
        console.error("Map object not found in addHooks.");
      }
    },

    removeHooks: function () {
      if (this._map) {
        console.log("Removing hooks: Detaching map click listener...");
        this._map.off("click", this._onMapClick, this);
        this._map.getContainer().style.cursor = "";
        this._enabled = false;
        console.log("Hooks removed. Drawing mode inactive.");
        this.fire("disabled");
      }
    },

    enabled: function () {
      return !!this._enabled;
    },

    _onMapClick: function (e) {
      console.log("--- MAP CLICK DETECTED (Simple Handler) ---");
      console.log("Click detected at:", e.latlng);
      alert(`Map clicked at: ${e.latlng.toString()}`);
    },
  });
})(window, document, L);
