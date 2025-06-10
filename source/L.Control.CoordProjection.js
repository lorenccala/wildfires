/**
 * L.Control.CoordProjection - A Leaflet control to display mouse coordinates in a custom projection.
 * Requires Proj4js and Proj4Leaflet for custom CRS support.
 */
(function (window, document, undefined) {
  // Check if Leaflet is loaded
  if (!L) {
    return;
  }

  L.Control.CoordProjection = L.Control.extend({
    options: {
      position: "bottomleft",
      separator: " | ",
      emptyString: "Mouse over the map",
      lngFirst: false,
      numDigits: 5,
      lngFormatter: undefined,
      latFormatter: undefined,
      prefix: "",
      crs: "EPSG4326", // Default CRS. Can be a string or an L.Proj.CRS object.
    },

    onAdd: function (map) {
      // Create the container for the control
      this._container = L.DomUtil.create(
        "div",
        "leaflet-control-coord-projection"
      );

      // Prevent map events from propagating to the container
      L.DomEvent.disableClickPropagation(this._container);

      // Add mouse listeners to the map
      map.on("mousemove", this._onMouseMove, this);
      map.on("mouseout", this._onMouseOut, this);

      // Set the initial text
      this._container.innerHTML = this.options.emptyString;

      return this._container;
    },

    onRemove: function (map) {
      // Remove mouse listeners from the map
      map.off("mousemove", this._onMouseMove, this);
      map.off("mouseout", this._onMouseOut, this);
    },

    _onMouseOut: function () {
      // Reset the text when the mouse leaves the map
      this._container.innerHTML = this.options.emptyString;
    },

    _onMouseMove: function (e) {
      // Project the mouse coordinates to the specified CRS
      let position = this._projectTo(this.options.crs, e.latlng);

      // Get the projected coordinates. For consistency with Leaflet's lat/lng,
      // Proj4Leaflet returns an object with x and y properties.
      let lng = position.x;
      let lat = position.y;

      // Format the coordinates
      let lngFormatted = this.options.lngFormatter
        ? this.options.lngFormatter(lng)
        : L.Util.formatNum(lng, this.options.numDigits);
      let latFormatted = this.options.latFormatter
        ? this.options.latFormatter(lat)
        : L.Util.formatNum(lat, this.options.numDigits);

      // Build the display string
      let value = this.options.lngFirst
        ? lngFormatted + this.options.separator + latFormatted
        : latFormatted + this.options.separator + lngFormatted;
      let prefixAndValue = this.options.prefix + " " + value;
      this._container.innerHTML = prefixAndValue;
    },

    _projectTo: function (crs, latLng) {
      // If crs is a Proj4Leaflet object, use its project method
      if (crs instanceof L.Proj.CRS) {
        return crs.project(latLng);
      }

      // If it's a standard string like 'EPSG4326', we just display the original lat/lng.
      // We return it with x/y properties for consistency in the _onMouseMove function.
      return {
        x: latLng.lng,
        y: latLng.lat,
      };
    },
  });

  // Factory function for creating the control
  L.control.coordProjection = function (options) {
    return new L.Control.CoordProjection(options);
  };
})(window, document);
