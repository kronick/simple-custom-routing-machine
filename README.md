# Build turn-by-turn directions on a network of custom paths with seamless handoffs to the global road network and the Mapbox Directions API

## Installation

`npm install simple-custom-routing-machine`

## Usage

_*For a sample application, see the 'examples' directory. You will need to provide your own Mapbox API token.*_

First, build a routable network of roads/paths using [geojson-network-parser](https://github.com/kronick/geojson-network-parser).

```
const scrm = require('simple-custom-routing-machine');

// Initialize the routing machine, defining the location of entrances
const routingMachine = new scrm(network, {
  entrances: [ {
    coordinates: [-22.102600322893295, -32.07816895133297],
    enterManeuver: {type: "stop", instruction: "Check in at the security gate."},
    exitManeuver: {type: "stop", instruction: "Check out at the security gate."}
  }],
  mapboxAccessToken: 'your_mapbox_access_token' // Needed to use the Mapbox Directions API
});

// Pick two points you want to route between
const a = [-22.3213,-32.0784333];
const b = [-23.3213,-32.0784333];

routingMachine.getDirections(a, b, (err, directions) => {
    if(err) {
      return console.log(err);
    } 
    
    // Build HTML from the directions instructions
    var instructions = directions.maneuvers.map(m => m.instruction).join("\n");

    console.log(instructions);
    
    // Optionally, use the route as a data source on a Mapbox GL JS map
    map.getSource('route').setData({type: "Feature", geometry: directions.geometry });
  });

```

## Building from source

Clone this repo then run:

```
npm install
npm run build
```

This will output a bundled js file to `dist/scrm.js`.
