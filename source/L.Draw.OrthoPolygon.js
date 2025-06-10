/**
 * L.Draw.OrthoPolygon.js
 * A Leaflet plugin for drawing orthogonal polygons with a toolbar control.
 * Final version with all corrections.
 */

// 1. Initialize Leaflet.Draw namespaces if they don't exist.
if (!L.Draw) L.Draw = {};
if (!L.Draw.Event) L.Draw.Event = {};
L.Draw.Event.CREATED = "draw:created";

// Define drawing phases as constants for clarity and to prevent typos
const DRAW_PHASES = {
  WAITING: "waiting", // Waiting for the first point
  DIRECTION: "direction", // Waiting for the direction of the first segment
  DISTANCE: "distance", // Waiting for user to input distance
  ORTHOGONAL: "orthogonal", // Waiting for subsequent orthogonal segments
};

// 2. Define the core drawing logic (the Handler)
L.Draw.OrthoPolygon = L.Handler.extend({
  includes: L.Evented.prototype, // Allow this class to fire events

  options: {
    polylineOptions: { color: "#007bff", weight: 3 },
    polygonOptions: {
      color: "green",
      fillColor: "#5cb85c",
      fillOpacity: 0.4,
      weight: 3,
    },
    snapTolerance: 10, // Increased for easier snapping
    previewDistance: 50, // Preview line length in pixels
    previewLineStyle: { color: "red", weight: 2, className: "preview-line" },
    leftPreviewLineStyle: {
      color: "orange",
      weight: 3,
      className: "preview-line",
    },
    rightPreviewLineStyle: {
      color: "purple",
      weight: 3,
      className: "preview-line",
    },
    snapMarkerStyle: { radius: 8, color: "green", fillOpacity: 0.5 },
  },

  /**
   * Initializes the orthogonal polygon drawing handler.
   * @param {L.Map} map - The Leaflet map instance.
   * @param {object} options - Handler options.
   */
  initialize: function (map, options) {
    L.Handler.prototype.initialize.call(this, map);
    L.Util.setOptions(this, options);
    // *** FIX: Bind the keydown event handler to this instance ***
    // This ensures that inside _onKeyDown, 'this' refers to the handler instance.
    this._onKeyDown = this._onKeyDown.bind(this);
  },

  /**
   * Enables the drawing handler.
   * Sets up event listeners and initializes state.
   */
  addHooks: function () {
    this._map.on("click", this._onMapClick, this);
    this._map.on("mousemove", this._onMouseMove, this);
    // Use the pre-bound event handler. No need for a third argument.
    document.addEventListener("keydown", this._onKeyDown);
    this._map.getContainer().style.cursor = "crosshair";
    this._resetState();
    this.fire("enabled");
  },

  /**
   * Disables the drawing handler.
   * Cleans up event listeners and drawing artifacts.
   */
  removeHooks: function () {
    this._map.off("click", this._onMapClick, this);
    this._map.off("mousemove", this._onMouseMove, this);
    // Remove the same pre-bound event handler.
    document.removeEventListener("keydown", this._onKeyDown);
    this._map.getContainer().style.cursor = "";
    this._cleanUp();
    this.fire("disabled");
  },

  /**
   * Resets the internal drawing state to start a new polygon.
   */
  _resetState: function () {
    this._points = [];
    this._distanceLabels = [];
    this._lastBearing = null;
    this._currentPhase = DRAW_PHASES.WAITING;
    this._mousePosition = null;

    this._cleanUp(); // Clean up any existing layers first

    // Create a feature group to hold all drawing artifacts for easy removal
    this._drawingLayer = new L.FeatureGroup().addTo(this._map);
  },

  /**
   * Removes all temporary drawing layers from the map.
   */
  _cleanUp: function () {
    if (this._drawingLayer) {
      this._map.removeLayer(this._drawingLayer);
      this._drawingLayer = null;
    }

    this._activePolyline = null;
    this._snapMarker = null;
    this._previewLine = null;
    this._leftPreviewLine = null;
    this._rightPreviewLine = null;

    this._removeTooltip();
  },

  /**
   * Handles map click events to progress the drawing state machine.
   * @param {L.LeafletEvent} e - The click event.
   */
  _onMapClick: function (e) {
    switch (this._currentPhase) {
      case DRAW_PHASES.WAITING:
        this._addPoint(e.latlng);
        this._currentPhase = DRAW_PHASES.DIRECTION;
        // Create an invisible, clickable marker on the first point for easy finishing
        if (!this._snapMarker) {
          this._snapMarker = L.circleMarker(
            e.latlng,
            this.options.snapMarkerStyle
          ).on("click", this._finishDrawing, this);
          this._drawingLayer.addLayer(this._snapMarker);
        }
        break;
      case DRAW_PHASES.DIRECTION:
        if (this._mousePosition) {
          this._lastBearing = this._calculateBearing(
            this._points[this._points.length - 1],
            this._mousePosition
          );
          this._showDistanceInput(e.latlng);
          this._currentPhase = DRAW_PHASES.DISTANCE;
        }
        break;
      case DRAW_PHASES.ORTHOGONAL:
        const lastPoint = this._points[this._points.length - 1];
        const clickBearing = this._calculateBearing(lastPoint, e.latlng);
        const leftBearing = (this._lastBearing - 90 + 360) % 360;
        const rightBearing = (this._lastBearing + 90) % 360;
        const leftDiff = Math.abs(
          this._angleDifference(clickBearing, leftBearing)
        );
        const rightDiff = Math.abs(
          this._angleDifference(clickBearing, rightBearing)
        );
        this._lastBearing = leftDiff < rightDiff ? leftBearing : rightBearing;
        this._showDistanceInput(e.latlng);
        this._currentPhase = DRAW_PHASES.DISTANCE;
        break;
    }
  },

  /**
   * Handles mouse move events to update previews.
   * @param {L.LeafletEvent} e - The mouse move event.
   */
  _onMouseMove: function (e) {
    this._mousePosition = e.latlng;
    if (this._currentPhase === DRAW_PHASES.DIRECTION) {
      this._showDirectionPreview();
    } else if (this._currentPhase === DRAW_PHASES.ORTHOGONAL) {
      this._showOrthogonalPreviews();
    }
  },

  /**
   * Handles keydown events for actions like escaping or deleting points.
   * @param {KeyboardEvent} e - The keydown event.
   */
  _onKeyDown: function (e) {
    if (e.key === "Escape") {
      this.disable();
    }
    if (e.key === "Backspace" && this._points.length > 0) {
      this._deleteLastPoint();
    }
  },

  /**
   * Adds a new point to the polygon's vertex list.
   * @param {L.LatLng} latlng - The coordinates of the point to add.
   */
  _addPoint: function (latlng) {
    this._points.push(latlng);
    if (this._points.length > 1) {
      this._drawActivePolyline();
    }
  },

  /**
   * Adds a new segment to the polygon based on a distance and the last bearing.
   * @param {number} distance - The length of the segment in meters.
   */
  _addSegment: function (distance) {
    const lastPoint = this._points[this._points.length - 1];
    const newPoint = this._computeDestinationPoint(
      lastPoint,
      this._lastBearing,
      distance
    );

    // Snap to the starting point if the new point is close enough
    if (this._points.length >= 2) {
      const distToStart = this._map.distance(newPoint, this._points[0]);
      if (distToStart <= this.options.snapTolerance) {
        this._finishDrawing();
        return;
      }
    }
    this._addPoint(newPoint);
    this._addDistanceLabel(lastPoint, newPoint, distance, this._lastBearing);
    this._removeTooltip();
    this._currentPhase = DRAW_PHASES.ORTHOGONAL;

    // Show the snap marker once we have enough points to form a polygon
    if (
      this._points.length >= 2 &&
      this._snapMarker &&
      !this._drawingLayer.hasLayer(this._snapMarker)
    ) {
      this._drawingLayer.addLayer(this._snapMarker);
    }
  },

  /**
   * Deletes the last added point and segment.
   */
  _deleteLastPoint: function () {
    if (this._points.length === 0) return;
    this._points.pop();

    if (this._distanceLabels.length > 0) {
      const labelToRemove = this._distanceLabels.pop();
      this._drawingLayer.removeLayer(labelToRemove);
    }

    // Hide the snap marker if we no longer have enough points to close the polygon
    if (
      this._points.length < 2 &&
      this._snapMarker &&
      this._drawingLayer.hasLayer(this._snapMarker)
    ) {
      this._drawingLayer.removeLayer(this._snapMarker);
    }

    // If we delete the very first point, remove the snap marker completely
    if (this._points.length === 0 && this._snapMarker) {
      this._drawingLayer.removeLayer(this._snapMarker);
      this._snapMarker = null;
    }

    this._clearPreviews();
    this._removeTooltip();

    if (this._points.length === 0) {
      this._currentPhase = DRAW_PHASES.WAITING;
      if (this._activePolyline) {
        this._drawingLayer.removeLayer(this._activePolyline);
        this._activePolyline = null;
      }
    } else if (this._points.length === 1) {
      this._currentPhase = DRAW_PHASES.DIRECTION;
      this._lastBearing = null;
      if (this._activePolyline) {
        this._drawingLayer.removeLayer(this._activePolyline);
        this._activePolyline = null;
      }
    } else {
      this._currentPhase = DRAW_PHASES.ORTHOGONAL;
      this._lastBearing = this._calculateBearing(
        this._points[this._points.length - 2],
        this._points[this._points.length - 1]
      );
      this._drawActivePolyline();
    }
  },

  /**
   * Finalizes the polygon, fires a creation event, and disables the handler.
   */
  _finishDrawing: function () {
    if (this._points.length < 2) {
      this.disable();
      return;
    }

    const p_n = this._points[this._points.length - 1];
    const p_0 = this._points[0];

    // No need to close if the polygon is already closed
    if (p_n.equals(p_0)) {
      const polygon = L.polygon(this._points, this.options.polygonOptions);
      const finalLayer = L.featureGroup([polygon]);
      this._distanceLabels.forEach((label) => finalLayer.addLayer(label));
      this._map.fire(L.Draw.Event.CREATED, {
        layer: finalLayer,
        layerType: "orthoPolygon",
      });
      this.disable();
      return;
    }

    const p_prev = this._points[this._points.length - 2];
    const lastBearing = this._calculateBearing(p_prev, p_n);

    // Calculate the two potential intersection points for orthogonal closing
    const leftTurnBearing = (lastBearing - 90 + 360) % 360;
    const rightTurnBearing = (lastBearing + 90 + 360) % 360;

    const intersectionLeft = this._intersection(
      p_n,
      leftTurnBearing,
      p_0,
      lastBearing
    );
    const intersectionRight = this._intersection(
      p_n,
      rightTurnBearing,
      p_0,
      lastBearing
    );

    let bestIntersection = null;

    // Choose the intersection that results in a shorter closing path
    if (intersectionLeft && intersectionRight) {
      const distLeft =
        this._map.distance(p_n, intersectionLeft) +
        this._map.distance(intersectionLeft, p_0);
      const distRight =
        this._map.distance(p_n, intersectionRight) +
        this._map.distance(intersectionRight, p_0);
      bestIntersection =
        distLeft < distRight ? intersectionLeft : intersectionRight;
    } else {
      bestIntersection = intersectionLeft || intersectionRight;
    }

    const points = [...this._points];

    if (bestIntersection) {
      points.push(bestIntersection);
      // Add labels for the new closing segments
      const bearingToInt = this._calculateBearing(p_n, bestIntersection);
      const bearingFromInt = this._calculateBearing(bestIntersection, p_0);
      this._addDistanceLabel(
        p_n,
        bestIntersection,
        this._map.distance(p_n, bestIntersection),
        bearingToInt
      );
      this._addDistanceLabel(
        bestIntersection,
        p_0,
        this._map.distance(bestIntersection, p_0),
        bearingFromInt
      );
    }

    const polygon = L.polygon(points, this.options.polygonOptions);
    const finalLayer = L.featureGroup([polygon]);
    this._distanceLabels.forEach((label) => finalLayer.addLayer(label));

    this._map.fire(L.Draw.Event.CREATED, {
      layer: finalLayer,
      layerType: "orthoPolygon",
    });
    this.disable();
  },

  /**
   * Displays the tooltip for entering the segment distance.
   * @param {L.LatLng} latlng - The position to display the tooltip.
   */
  _showDistanceInput: function (latlng) {
    this._removeTooltip();
    this._clearPreviews();
    const container = L.DomUtil.create(
      "div",
      "leaflet-draw-tooltip",
      this._map.getContainer()
    );
    this._tooltip = container;
    const canFinish = this._points.length >= 3;
    container.innerHTML = `<div class="ortho-tooltip-content"><strong>Enter distance (m):</strong><input type="number" id="orthoDistanceInput" step="0.01" min="0.01" autofocus /><button id="orthoFinishBtn" title="Finish Polygon" ${
      !canFinish ? "disabled" : ""
    }>Finish</button></div>`;

    const pos = this._map.latLngToContainerPoint(latlng);
    L.DomUtil.setPosition(this._tooltip, pos.add(new L.Point(20, -20)));

    const input = container.querySelector("#orthoDistanceInput");
    const finishBtn = container.querySelector("#orthoFinishBtn");
    L.DomEvent.on(finishBtn, "click", this._finishDrawing, this);
    L.DomEvent.on(
      input,
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          L.DomEvent.stop(e);
          const distance = parseFloat(input.value);
          if (!isNaN(distance) && distance > 0) this._addSegment(distance);
        }
      },
      this
    );

    input.focus();

    if (this._activePolyline) {
      this._drawingLayer.removeLayer(this._activePolyline);
    }
    this._activePolyline = L.polyline(
      this._points,
      this.options.polylineOptions
    );
    this._drawingLayer.addLayer(this._activePolyline);
  },

  /**
   * Adds a distance label to a polygon segment.
   * @param {L.LatLng} p1 - The starting point of the segment.
   * @param {L.LatLng} p2 - The ending point of the segment.
   * @param {number} distance - The length of the segment.
   * @param {number} bearing - The bearing of the segment.
   */
  _addDistanceLabel: function (p1, p2, distance, bearing) {
    const midPoint = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);

    let angle = bearing - 90;
    if (bearing > 90 && bearing < 270) {
      angle += 180;
    }

    const label = L.marker(midPoint, {
      icon: L.divIcon({
        className: "ortho-distance-label",
        html: `<div style="transform: rotate(${angle}deg);">${distance.toFixed(
          2
        )}m</div>`,
      }),
    });

    this._distanceLabels.push(label);
    this._drawingLayer.addLayer(label);
  },

  /**
   * Shows a preview line from the last point to the current mouse position.
   */
  _showDirectionPreview: function () {
    this._clearPreviews();
    if (this._points.length > 0 && this._mousePosition) {
      this._previewLine = L.polyline(
        [this._points[this._points.length - 1], this._mousePosition],
        this.options.previewLineStyle
      );
      this._drawingLayer.addLayer(this._previewLine);
    }
  },

  /**
   * Shows preview lines for the two possible orthogonal directions.
   */
  _showOrthogonalPreviews: function () {
    this._clearPreviews();
    if (this._points.length > 0 && this._lastBearing !== null) {
      const lastPoint = this._points[this._points.length - 1];
      const leftBearing = (this._lastBearing - 90 + 360) % 360;
      const leftPoint = this._computeDestinationPoint(
        lastPoint,
        leftBearing,
        this.options.previewDistance
      );
      const rightBearing = (this._lastBearing + 90) % 360;
      const rightPoint = this._computeDestinationPoint(
        lastPoint,
        rightBearing,
        this.options.previewDistance
      );
      this._leftPreviewLine = L.polyline(
        [lastPoint, leftPoint],
        this.options.leftPreviewLineStyle
      );
      this._drawingLayer.addLayer(this._leftPreviewLine);
      this._rightPreviewLine = L.polyline(
        [lastPoint, rightPoint],
        this.options.rightPreviewLineStyle
      );
      this._drawingLayer.addLayer(this._rightPreviewLine);
    }
  },

  /**
   * Removes all preview lines from the map.
   */
  _clearPreviews: function () {
    [this._previewLine, this._leftPreviewLine, this._rightPreviewLine].forEach(
      (line) => {
        if (line && this._drawingLayer.hasLayer(line)) {
          this._drawingLayer.removeLayer(line);
        }
      }
    );
    this._previewLine = this._leftPreviewLine = this._rightPreviewLine = null;
  },

  /**
   * Removes the distance input tooltip from the DOM.
   */
  _removeTooltip: function () {
    if (this._tooltip) {
      L.DomUtil.remove(this._tooltip);
      this._tooltip = null;
    }
  },

  /**
   * Converts degrees to radians.
   * @param {number} deg - The angle in degrees.
   * @returns {number} The angle in radians.
   */
  _toRad: function (deg) {
    return (deg * Math.PI) / 180;
  },

  /**
   * Converts radians to degrees.
   * @param {number} rad - The angle in radians.
   * @returns {number} The angle in degrees.
   */
  _toDeg: function (rad) {
    return (rad * 180) / Math.PI;
  },

  /**
   * Calculates the bearing between two points.
   * @param {L.LatLng} p1 - The starting point.
   * @param {L.LatLng} p2 - The ending point.
   * @returns {number} The bearing in degrees.
   */
  _calculateBearing: function (p1, p2) {
    const φ1 = this._toRad(p1.lat),
      λ1 = this._toRad(p1.lng);
    const φ2 = this._toRad(p2.lat),
      λ2 = this._toRad(p2.lng);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    return (this._toDeg(Math.atan2(y, x)) + 360) % 360;
  },

  /**
   * Calculates a destination point given a starting point, bearing, and distance.
   * @param {L.LatLng} startPoint - The starting point.
   * @param {number} bearing - The bearing in degrees.
   * @param {number} distance - The distance in meters.
   * @returns {L.LatLng} The calculated destination point.
   */
  _computeDestinationPoint: function (startPoint, bearing, distance) {
    const R = 6371e3;
    const δ = distance / R;
    const θ = this._toRad(bearing);
    const φ1 = this._toRad(startPoint.lat);
    const λ1 = this._toRad(startPoint.lng);
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
      );
    return L.latLng(this._toDeg(φ2), this._toDeg(λ2));
  },

  /**
   * Calculates the shortest angle difference between two angles.
   * @param {number} a1 - The first angle in degrees.
   * @param {number} a2 - The second angle in degrees.
   * @returns {number} The difference in degrees.
   */
  _angleDifference: function (a1, a2) {
    let diff = a1 - a2;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff;
  },

  _drawActivePolyline: function () {
    if (this._activePolyline) {
      this._activePolyline.setLatLngs(this._points);
    } else {
      this._activePolyline = L.polyline(
        this._points,
        this.options.polylineOptions
      );
      this._drawingLayer.addLayer(this._activePolyline);
    }
  },

  /**
   * Calculates the intersection of two paths given start points and bearings.
   * Adapted from https://github.com/chrisveness/geodesy/blob/master/latlon-spherical.js
   * @param {L.LatLng} p1 - Start point of path 1.
   * @param {number} brng1 - Bearing of path 1 in degrees.
   * @param {L.LatLng} p2 - Start point of path 2.
   * @param {number} brng2 - Bearing of path 2 in degrees.
   * @returns {L.LatLng|null} The intersection point, or null if no unique intersection.
   */
  _intersection: function (p1, brng1, p2, brng2) {
    const φ1 = this._toRad(p1.lat),
      λ1 = this._toRad(p1.lng);
    const φ2 = this._toRad(p2.lat),
      λ2 = this._toRad(p2.lng);
    const θ13 = this._toRad(brng1),
      θ23 = this._toRad(brng2);
    const Δφ = φ2 - φ1,
      Δλ = λ2 - λ1;

    const δ12 =
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
        )
      );
    if (δ12 === 0) return null;

    let θa = Math.acos(
      (Math.sin(φ2) - Math.sin(φ1) * Math.cos(δ12)) /
        (Math.sin(δ12) * Math.cos(φ1))
    );
    if (isNaN(θa)) θa = 0;
    let θb = Math.acos(
      (Math.sin(φ1) - Math.sin(φ2) * Math.cos(δ12)) /
        (Math.sin(δ12) * Math.cos(φ2))
    );

    const θ12 = Math.sin(λ2 - λ1) > 0 ? θa : 2 * Math.PI - θa;
    const θ21 = Math.sin(λ1 - λ2) > 0 ? Math.PI + θb : Math.PI - θb;

    const α1 = ((θ13 - θ12 + Math.PI) % (2 * Math.PI)) - Math.PI;
    const α2 = ((θ21 - θ23 + Math.PI) % (2 * Math.PI)) - Math.PI;

    if (Math.sin(α1) === 0 && Math.sin(α2) === 0) return null;
    if (Math.sin(α1) * Math.sin(α2) < 0) return null;

    const α3 = Math.acos(
      -Math.cos(α1) * Math.cos(α2) + Math.sin(α1) * Math.sin(α2) * Math.cos(δ12)
    );
    const δ13 = Math.atan2(
      Math.sin(δ12) * Math.sin(α1) * Math.sin(α2),
      Math.cos(α2) + Math.cos(α1) * Math.cos(α3)
    );
    const φ3 = Math.asin(
      Math.sin(φ1) * Math.cos(δ13) +
        Math.cos(φ1) * Math.sin(δ13) * Math.cos(θ13)
    );
    const Δλ13 = Math.atan2(
      Math.sin(θ13) * Math.sin(δ13) * Math.cos(φ1),
      Math.cos(δ13) - Math.sin(φ1) * Math.sin(φ3)
    );
    const λ3 = λ1 + Δλ13;

    return L.latLng(this._toDeg(φ3), this._toDeg(λ3.toFixed(8))); // Round to avoid floating point issues
  },
});

// 3. Define the toolbar button (the Control)
L.Control.OrthoDraw = L.Control.extend({
  options: {
    position: "topleft",
  },

  onAdd: function (map) {
    this._orthoHandler = new L.Draw.OrthoPolygon(
      map,
      this.options.handlerOptions
    );

    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    this._link = L.DomUtil.create("a", "leaflet-draw-ortho", container);
    this._link.href = "#";
    this._link.title = "Draw an orthogonal polygon";

    this._orthoHandler.on("enabled", () =>
      L.DomUtil.addClass(this._link, "leaflet-draw-ortho-active")
    );
    this._orthoHandler.on("disabled", () =>
      L.DomUtil.removeClass(this._link, "leaflet-draw-ortho-active")
    );

    L.DomEvent.on(this._link, "click", L.DomEvent.stop).on(
      this._link,
      "click",
      () => {
        if (this._orthoHandler.enabled()) {
          this._orthoHandler.disable();
        } else {
          this._orthoHandler.enable();
        }
      }
    );

    return container;
  },

  onRemove: function (map) {
    this._orthoHandler.disable();
  },
});

// 4. Create the factory function for the control.
L.control.orthoDraw = function (options) {
  return new L.Control.OrthoDraw(options);
};
