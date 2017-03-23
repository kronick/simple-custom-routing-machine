window.$ = require('jquery-browserify');
const NetworkParser = require('geojson-network-parser');
const scrm = require('simple-custom-routing-machine');

var emptyData = {type: "Feature", geometry: {type: "Point", coordinates: []}};

var config = {
    "MAPBOX_ACCESS_TOKEN": "your_access_token_here"
};

var network, routingMachine;
var routeStart, routeEnd, routeOffsiteStart, routeOffsiteEnd, route;
var startMarker, endMarker;

window.map = undefined;

var debugNetwork = true; // Set to `true` to draw all edges, nodes, and intersections inferred from the geojson road network

$(document).ready(function() {
    mapboxgl.accessToken = config["MAPBOX_ACCESS_TOKEN"];
    map = new mapboxgl.Map({
      container: 'map-container',
      style: 'mapbox://styles/kronick/cizg4y43h00f82sqiub83ym84',
      center: [-100.3801, 47.1366],
      zoom: 14,
      minZoom: 3
    });

    map.on("load", function() {

      setupLayers();

        // Download the GeoJSON file containing all features
        $.get("data/site.geojson")
          .done(function(data) {
            var geojson = JSON.parse(data);
            // Filter the features to find only the relevant road layers
            var roads = geojson.features.filter(function(f) { return f.properties.layer === "Roads" || f.properties.layer === "mine-road" });
            
            // Turn the GeoJSON FeatureCollection of roads into a network that we can route directions on
            network = new NetworkParser(roads, "weight", 2);
            var parsed = network.parse({
              tolerance: 0.0000175,   // Ignore gaps greater than this distance. Units are in degrees latitude, so values < 0.00002 are a good starting point.
              ignoreCrossings: false  // If `true`, intersections will only be added where there are two nearby points in the original FeatureCollection. If `false`, intersections will be inferred where two edge segments cross each other.
            });  

            // Set up the local routing manager with the location of the entrance/exit to public roads
            routingMachine = new scrm(network, {
              entrances: [ {
                coordinates: [-100.3895796068651, 47.14025809259155],
                enterManeuver: {type: "stop", instruction: "Check in at the security gate."},
                exitManeuver: {type: "stop", instruction: "Check out at the security gate."}
              }],
              mapboxAccessToken: config["MAPBOX_ACCESS_TOKEN"]
            });

            // If debugNetwork is true, draw on the Mapbox map all edges, nodes, and intersections inferred from the GeoJSON road network 
            if(debugNetwork) {
              generateDebugView(map, parsed);
            }

            moveMarker("start", [-100.38848438931034, 47.13992773413386]);
            moveMarker("end", [-100.37492397528518, 47.13330685739058]);
            updateDirections();
          })
          .fail(function(error) {
            console.log(error);
          });
      
      map.on("mousemove", function(e) {
        var b = 3;
        var bbox = [[e.point.x - b, e.point.y - b], [e.point.x + b, e.point.y + b]]
        var segments = map.queryRenderedFeatures(bbox, {layers: ['segments']});
        if(segments.length === 0) return map.getSource('segments-highlight').setData(emptyData);

        var id = segments[0].properties.edgeGroup;

        var feature = {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: network.edgeGroups[id].lineStringCoordinates
          }
        }

        map.getSource('segments-highlight').setData(feature);
      });    

      //map.on("click", updateDirections); 


    }); // --- map.on("load")  
});


waitingForDirections = false;
directionsQueued = false;
function updateDirections() {
  if(waitingForDirections) {
    directionsQueued = true;
    return;
  }

  try {
    var a = startMarker.getLngLat().toArray();
    var b = endMarker.getLngLat().toArray();
  }
  catch (e) {
    return console.log("Markers not in place.");
  }

  routingMachine.getDirections(a, b, (err, directions) => {
    if(err) {
      waitingForDirections = false;
      if(directionsQueued) {
        directionsQueued = false;
        updateDirections();
      } 
      return console.log(err);
    } 

    // Build HTML from the directions instructions
    var instructions = "";
    directions.maneuvers.forEach(m => {
      var modifier = m.modifier;
      var type = m.type;
      var icon = "";

      if(modifier === "left" && type === "turn") icon = "<svg class='icon inline mr6'><use xlink:href='#icon-turn-left'/></svg>";
      else if(modifier === "right" && type === "turn") icon = "<svg class='icon inline mr6'><use xlink:href='#icon-turn-right'/></svg>";
      else if(type ==="stop") icon = "<svg class='icon inline mr6'><use xlink:href='#icon-hand'/></svg>";
      else icon = "<svg class='icon inline mr6'><use xlink:href='#icon-arrow-up'/></svg>"

      instructions += icon + m.instruction + "<br>";
    });

    $("#directions").html(instructions);

    map.getSource('route').setData({type: "Feature", geometry: directions.geometry });
    
    waitingForDirections = false;
    if(directionsQueued) {
      directionsQueued = false;
      updateDirections();
    } 
  });
}

function moveMarker(startOrEnd, position) {
  var marker;
  if(startOrEnd === "start") {
    marker = startMarker;
  }
  else {
    marker = endMarker;
  }

  if(marker === undefined) {
    if(position === undefined) return;

    // Create it
    var s = 32;
    var el = document.createElement('div');
    el.className = 'marker';
    el.style.backgroundImage = 'url(img/marker-' + (startOrEnd === 'start' ? 1 : 2) + '.png)';
    el.style.width = s + 'px';
    el.style.height = s + 'px';
    el.style.backgroundSize = 'cover';

    marker = new mapboxgl.Marker(el, {offset: [-s/2, -s/2]})
      .setLngLat({lng: position[0], lat: position[1]})
      .addTo(map);


    el.setAttribute("id", "marker-" + startOrEnd);

    var drag = d3.drag()
        .on('start', function(){
            // clearMap();
        })
        .on('drag', function(){
            var x = d3.event.sourceEvent.layerX;
            var y = d3.event.sourceEvent.layerY;
            var newCoords= map.unproject([x, y])
            var c = [newCoords.lng, newCoords.lat];
            marker.setLngLat(c);
            updateDirections();
            // d3.select(this)
            //     .style('transform', function(){
            //         var x = d3.event.sourceEvent.layerX - s / 2;
            //         var y = d3.event.sourceEvent.layerY - s / 2;
            //         return 'translateX('+ x +'px) translateY('+ y +'px)'
            //     })
        })
        .on('end', function(d,i){
            
        });
    d3.select("#marker-" + startOrEnd)
        .call(drag)

    if(startOrEnd === "start") {
      startMarker = marker;
    }
    else {
      endMarker = marker;
    }

  }
  else {
    // Update it
    if(position !== undefined) {
      marker.setLngLat({lng: position[0], lat: position[1]}).addTo(map);
    }
    else {
      // Delete it
      //marker.remove();
    }
  }
  
}


function setupLayers() {
  map.addLayer({
    id: 'edges',
    source: {
      type: 'geojson',
      data: emptyData
    },
    type: 'line',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-width': {
        stops: [
          [0, 1],
          [12, 2]
        ]
      },
      'line-color': {
        property: "direction",
        type: "categorical",
        stops: [
          ["A", '#77ff77'],
          ["B", '#ff7777']
        ]
      },
      'line-offset': {
        property: "direction",
        type: "categorical",
        stops: [
          ["A", 2],
          ["B", 0]
        ]              
      }
    }
  });

  map.addLayer({
    id: 'segments',
    source: {
      type: 'geojson',
      data: emptyData
    },
    type: 'line',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-width': {
        stops: [
          [0, 0.5],
          [12, 2]
        ]
      },
      'line-color': '#FF00FF',
      'line-opacity': 0.0001
    }
  });

  map.addLayer({
    id: 'segments-highlight',
    source: {
      type: 'geojson',
      data: emptyData
    },
    type: 'line',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-width': {
        stops: [
          [0, 1],
          [12, 4]
        ]
      },
      'line-color': '#FF00FF'
    }
  });

  map.addLayer({
    id: 'nodes-network',
    source: {
      type: 'geojson',
      data: emptyData
    },
    type: 'circle',
    paint: {
      //'fill-color': '#ff7777'
      'circle-color': '#ff7777',
      'circle-radius': 8
    }
  });

  map.addLayer({
    id: 'nodes-all',
    source: {
      type: 'geojson',
      data: emptyData
    },
    type: 'circle',
    paint: {
      //'fill-color': '#ff7777'
      'circle-color': {
        property: 'edges',
        type: 'interval',
        stops: [
          [1, '#FF7777'],
          [2, '#FFFFFF'],
          [3, '#7777FF'],
          [4, '#77FF77'],
        ]
      },
      'circle-radius': 4,
      'circle-opacity': {
        property: 'edges',
        type: 'interval',
        stops: [
          [1, 1],
          [2, 0],
          [3, 1]
        ]
      }
    }
  });

  map.addLayer({
    id: 'route',
    source: {
      type: 'geojson',
      data: emptyData
    },
    type: 'line',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-width': {
        stops: [
          [0, 2],
          [12, 4]
        ]
      },
      'line-color': '#377AED'
    }
  });
}

function generateDebugView(map, parsedNetwork) {
  var points = parsedNetwork.nodes.map((n) => {
    return {
      type: "Feature",
      properties: {
        edges: n.edges.length
      },
      geometry: {
        type: "Point",
        coordinates: n.coordinates
      }
    }
  });
  
  var edges = parsedNetwork.edges.map(e => {
    var r = Math.random();
    var color;
    if (r < 0.3) color = "A";
    else if (r < 0.6) color = "B";
    else color = "C";

    return {
      type: "Feature",
      properties: {
        direction: e.direction
      },
      geometry: {
        type: "LineString",
        coordinates: [e.start.coordinates, e.end.coordinates]
      }
    }
  });

  var edgeGroups = parsedNetwork.edgeGroups.map(e => {
    return {
      type: "Feature",
      properties: {
        edgeGroup: e.id
      },
      geometry: {
        type: "LineString",
        coordinates: e.lineStringCoordinates
      }
    }
  });
  map.getSource('nodes-all').setData({type: "FeatureCollection", features: points});
  map.getSource('edges').setData({type: "FeatureCollection", features: edges});
  map.getSource('segments').setData({type: "FeatureCollection", features: edgeGroups});

}