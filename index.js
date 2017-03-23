const turf = require('@turf/turf');
const request = require('request');

/** 
 * Module that orchestrates routing on a network of private, local ways with handoffs to the Mapbox Directions API for public streets directions when needed .
 * @module SimpleCustomRoutingMachine
 */

/**
 * Creates a new SimpleCustomRoutingMachine instance
 * @constructor
 * @param {NetworkParser} network - The {@link NetworkParser} object containing a network of local ways.
 * @param {Object} options - Options to configure local routing and handoff to public streets
 * @param {Number} [options.maxSnap=200] - Maximum distance (in meters) that a point will jump to the local way network. If a point requested for directions is further than this distance from a local way, it will be interpreted as if it exists on the public road network.
 * @param {Object[]} [options.entrances=[]] - An array of entrance/exit location objects that can be used to transition between local and public road networks.
 * @param {String} options.mapboxAccessToken - Your Mapbox API access token used for getting directions on public roads
 */
function SimpleCustomRoutingMachine(network, options) {
    this.network = network;
    this.options = options || {};
    if(this.options.maxSnap === undefined) this.options.maxSnap = 200;
    if(this.options.entrances === undefined) this.options.entrances = [];
    if(this.options.mapboxAccessToken === undefined) this.options.mapboxAccessToken = "";

    this.options.entrances = this.options.entrances.slice().forEach(e => {
      e.enterManeuver.location = e.coordinates.slice();
      e.exitManeuver.location = e.coordinates.slice();
    });
}

SimpleCustomRoutingMachine.prototype = {
    /** 
     * Get directions between two points. Automatically determines if the route starts/ends off of the local way network and transitions to the public ways as needed.
     * @param {Number[]} a - The starting point
     * @param {Number[]} b - The destination point
     * @param {function} callback - A callback function that will be called with the results of the directions request.
     */
    getDirections: function(a, b, callback) {
        var entrance = this.options.entrances[0]; // TODO: Handle multiple entrances
        var entranceNode = entrance === undefined ? undefined : this.network.getNearestNode(entrance.coordinates).node;
        //console.log(entranceNode);

        routeStart = undefined;
        routeEnd = undefined;

        var nearestA = this.network.getNearestNode(a);
        var nearestB = this.network.getNearestNode(b);
        // Check if the points are near enough to a local road network
        if(nearestA.distance > this.options.maxSnap && entranceNode !== undefined) {
            // Use Directions API for this point  
            routeOffsiteStart = a;
            routeStart = entranceNode;
        }
        else {
            // Use local routing
            routeOffsiteStart = false;
            routeStart = nearestA.node;
        }

        if(nearestB.distance > this.options.maxSnap && entranceNode !== undefined) {
            // Use Directions API for this point  
            routeOffsiteEnd = b;
            routeEnd = entranceNode;
        }
        else {
            // Use local routing
            routeOffsiteEnd = false;
            routeEnd = nearestB.node;
        }


        if(routeOffsiteStart || routeOffsiteEnd) {
            // Use Directions API
            var coordinates = "";

            if(!routeOffsiteStart)
              coordinates += routeEnd.coordinates[0] + "," + routeEnd.coordinates[1] + ";";
            else 
              coordinates += routeOffsiteStart[0] + "," + routeOffsiteStart[1] + ";";

            if(!routeOffsiteEnd) 
              coordinates += routeStart.coordinates[0] + "," + routeStart.coordinates[1];
            else
              coordinates += routeOffsiteEnd[0] + "," + routeOffsiteEnd[1]

            waitingForDirections = true;
            request({
                method: "get",
                url: "https://api.mapbox.com/directions/v5/mapbox/driving/" + coordinates + "?geometries=geojson&steps=true&overview=full&access_token=" + this.options.mapboxAccessToken,
                json: true
            }, (err, res, json) => {
                if(res.statusCode !== 200 || err) return callback(err || {statusCode: res.statusCode, body: res.body});

                var route = json.routes[0];
                var steps = route.legs[0].steps;
                var offsiteCoords = route.geometry.coordinates;
                var coordsOut;
                var maneuversOut;
                var offsiteManeuvers = steps.map(s => s.maneuver);

                if(routeOffsiteStart && routeOffsiteEnd) {
                    // Completely offsite
                    coordsOut = offsiteCoords;
                    maneuversOut = offsiteManeuvers;
                }
                else {
                    // Have to figure out order and concat directions accordingly
                    var localRoute = this._getLocalRoute(routeStart, routeEnd);

                    if(routeOffsiteStart) {
                      coordsOut = offsiteCoords.concat(localRoute.route.coordinates);
                      offsiteManeuvers = offsiteManeuvers.slice(0, offsiteManeuvers.length - 1).concat([entrance.enterManeuver]);
                      maneuversOut = offsiteManeuvers.concat(localRoute.maneuvers.slice(1));
                    }
                    else {
                      coordsOut = localRoute.route.coordinates.concat(offsiteCoords);
                      maneuversOut = localRoute.maneuvers.concat([entrance.exitManeuver]).concat(offsiteManeuvers);
                    }
                }

                callback(null, {geometry: { type: "LineString", coordinates: coordsOut }, maneuvers: maneuversOut });
            });
          }
          else {
            // Only need a local route
            var localRoute = this._getLocalRoute(routeStart, routeEnd);
            callback(null, {geometry: {type: "LineString", coordinates: localRoute.route.coordinates}, maneuvers: localRoute.maneuvers});
          }
    },

    _getLocalRoute: function(a, b) {
      var route = this.network.findShortestPath(a, b);
      var maneuvers = this._buildTurnByTurn(route.nodes);
      
      return {maneuvers: maneuvers, route: route};
      
    },

    /** 
     * Generate an array of turn-by-turn text instructions given a set of nodes along a route.
     */
    _buildTurnByTurn: function(nodes) {
      var maneuvers = [];
      var lastBearing, lastLastBearing, lastNode;
      var segmentLength = 0;
      nodes.forEach((n, i) => {
        if (i === 0) { // Don't do anything on the first node
          lastNode = n;
          return;
        }
        
        var segmentComplete = false;
        var turned;

        lastBearing = turf.bearing(turf.point(lastNode.coordinates), turf.point(n.coordinates));
        if (i === 1) { // Special case for first segment
          maneuvers.push({
            type: "depart",
            bearing_before: lastBearing,
            bearing_after: lastBearing,
            location: lastNode.coordinates,
            instruction: "Start heading " + this._degrees2cardinal(lastBearing)
          });
        }
        else {
          // Check if we've just left an intersection and made a turn
          var turn = this._determineTurnDirection(lastBearing, lastLastBearing);
          if(lastNode.edges.length > 2 && Math.abs(turn.delta) > 15) {
            turned = turn.type + turn.direction; // + " (" + turn.delta + " degrees)";
            segmentComplete = true;
          }
        }
        
        // Increment segment length
        if(!turned)
          segmentLength += turf.distance(turf.point(lastNode.coordinates), turf.point(n.coordinates), "meters");

        // Close segment on final node
        if(i === nodes.length - 1) segmentComplete = true;

        if(segmentComplete) {
          var distanceString = segmentLength >= 1000 ? ((segmentLength / 1000).toFixed(2) + " km") : (segmentLength.toFixed(0) + " meters.");

          maneuvers.push({
            type: "continue",
            bearing_before: lastLastBearing,
            bearing_after: lastBearing,
            modifier: "straight",
            location: lastNode.coordinates,
            distance: segmentLength,
            instruction: "Continue for " + distanceString
          });

          segmentLength = 0;
        }

        if(turned !== undefined) {
          maneuvers.push({
            type: "turn",
            bearing_before: lastLastBearing,
            bearing_after: lastBearing,
            modifier: turned,
            location: lastNode.coordinates,
            instruction: "Take a " + turned + " turn"
          });

          segmentLength += turf.distance(turf.point(lastNode.coordinates), turf.point(n.coordinates), "meters");
          
          // Special case if we end right after a turn. TODO: clean this up
          if(i === nodes.length - 1) {
            var distanceString = segmentLength >= 1000 ? ((segmentLength / 1000).toFixed(2) + " km") : (segmentLength.toFixed(0) + " meters.");

            maneuvers.push({
                type: "continue",
                bearing_before: lastBearing,
                bearing_after: lastBearing,
                modifier: "straight",
                location: lastNode.coordinates,
                distance: segmentLength,
                instruction: "Continue for " + distanceString
            });
          }
        }


        lastNode = n;
        lastLastBearing = lastBearing;
      });

      return maneuvers;
    },

    _degrees2cardinal: function(deg) {
      // Normalize to within 0 and 360 degrees
      while(deg < 0) deg += 360;
      while(deg >= 360) deg -= 360;
      if(deg < 22.5)   return "north";
      if(deg < 67.5)   return "northeast";
      if(deg < 112.5)  return "east";
      if(deg < 157.5)  return "southeast";
      if(deg < 202.5)  return "south";
      if(deg < 247.5)  return "southwest";
      if(deg < 292.5)  return "west";
      if(deg < 337.5)  return "northwest";

      return "north";
    },

    _determineTurnDirection: function(a, b) {
      // TODO: This gets the turn direction wrong sometimes.
      var delta = a - b;
      if (delta > 180) {
        delta = 360 - delta;
      }
      if (delta < -180) {
        delta = -360 - delta;
      }
      var direction = delta > 0 ? "right" : "left";
      var type = "";
      if (Math.abs(delta) > 90) type = "sharp ";
      else if (Math.abs(delta) < 22.5) type = "slight ";
      return {direction: direction, type: type, delta: delta};
    }
}

module.exports = exports = SimpleCustomRoutingMachine;