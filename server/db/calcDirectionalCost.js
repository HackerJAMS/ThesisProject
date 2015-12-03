/***

  Utility Function File:
  Add elevation cost to table "ways" based on elevation in table "nodes".
  elevation cost is for each line segment, which is defined as:
  sum of elevation differences between every two neighbor points on one segment 
  normalized by their distance

***/

var db = require('./db.js');
var Q = require('q');
module.exports = function() {

  // ALTER TABLE ways ADD COLUMN el_dist_cost double precision
  // ALTER TABLE ways ADD COLUMN r_el_dist_cost double precision

  // ALTER TABLE nodes_with_elevation ADD COLUMN geog geometry;
  // UPDATE nodes_with_elevation SET geog = ST_SetSRID(ST_MakePoint(lon, lat), 4326);
  // CREATE INDEX geog_idx ON nodes_with_elevation USING gist (geog);

  // create an auto-increasing column count in table ways
  // CREATE SEQUENCE seq;
  // ALTER TABLE ways ADD COLUMN count integer UNIQUE;
  // ALTER TABLE ways ALTER COLUMN count SET DEFAULT NEXTVAL('seq');
  // UPDATE ways SET count = NEXTVAL('seq');
  subSetQuery(2201, 2300);
}

var subSetQuery = function(countStart, countEnd) {
  var start = new Date().getTime();
  var queryString = "SELECT gid, length, ST_AsText(ST_Transform(the_geom,4326)) FROM ways WHERE class_id > 107 AND count >=" + countStart + " AND count <=" + countEnd;

  db.query(queryString, function(err, result) {
    if (err) {
      console.log("err when query table ways...", err);
    }
    console.log('successfully fetched data!');

    var counter = 0;
    var total_rows = result.rows.length;
    console.log("total rows back: ", result.rows.length)
    for (var i = 0; i < result.rows.length; i++) {
      getElevations(i, result)
        .then(getCost)
        .then(function(param) {
          var currentGid = result.rows[param.index].gid;
          db.query("UPDATE ways SET el_dist_cost = " + param.to_cost + ", r_el_dist_cost= " + param.rev_cost + " where gid =" + currentGid, function(err, result) {
              counter++;
              if (err) {
                console.log("i", param.index, "error when update cost columns...", err);
              } else {
                console.log("i", param.index, "successfully updated cost!");
                if (counter === total_rows) {
                  console.log("updating cost is done for count between " + countStart + " and " + countEnd);
                  if (countEnd < 42469) {
                    countStart = countStart + 100;
                    countEnd = countEnd + 100;
                    subSetQuery(countStart, countEnd);
                  } else {
                    var end = new Date().getTime();
                    console.log("Execution time: " + (end - start) / 1000 + 's');
                  }
                }
              }
            })
            // console.log('gid: ', result.rows[param.index].gid);
        })
        .catch(function(err) {
          console.log('error...', err);
        })
    }
  });
};

// get elevations of points on the ith line segment
var getElevations = function(i, result) {
  var defer = Q.defer();
  var string = result.rows[i].st_astext;
  var stringArr = string.slice(11, string.length - 1).split(',');
  var elevation = [];
  var count = 0;
  // console.log('getElevations start i', i, "gid", result.rows[i].gid);
  for (var j = 0; j < stringArr.length; j++) {
    (function(j) {
      var pi = stringArr[j].split(' ');
      db.query("SELECT * from nodes_with_elevation where geog=ST_MakePoint(" + pi[0] + "," + pi[1] + ");", function(err, nodes) {
        if (err) {
          console.log('error during getElevations', err);
          defer.reject(err);
        }
        // console.log('nodes', nodes.rows[0]);
        elevation[j] = nodes.rows[0].elevation;
        count++;
        if (count === stringArr.length) {
          defer.resolve({
            index: i,
            stringArr: stringArr,
            length: result.rows[i].length,
            elevation: elevation
          });
          console.log('getElevations end i', i, "gid", result.rows[i].gid);
        }
      })
    })(j)
  }
  return defer.promise;
}

// calculate cost of each line segment based on elevation change of points on the segment
var getCost = function(param) {
  var defer = Q.defer();
  var to_cost = 0;
  var rev_cost = 0;
  var count = 0;
  var sin_theta;
  var elevation = param.elevation;
  var stringArr = param.stringArr;
  if (stringArr.length === 2) {
    // cost = (arcsin(elevation_change/distance) + 90) * distance
    // the Math trig functions natively take and return radians, so we multiply by 180/PI to convert to degrees
    // units of elevation and distance must be the same, and param.length is in km, so we multiply by 1000 to standardize.
    sin_theta = ((+elevation[1]) - (+elevation[0])) / (param.length * 1000);
    to_cost += (Math.asin(sin_theta) * (180 / Math.PI) + 90) * (param.length * 1000);
    rev_cost += (Math.asin(sin_theta * -1) * (180 / Math.PI) + 90) * (param.length * 1000);
    defer.resolve({
      index: param.index,
      to_cost: to_cost,
      rev_cost: rev_cost
    });
  } else {
    for (var k = 0; k < stringArr.length - 1; k++) {
      (function(k) {
        var p1 = stringArr[k].split(' ');
        var p2 = stringArr[k + 1].split(' ');
        var len = 0
        db.query("SELECT ST_Distance_Spheroid(ST_MakePoint(" + p1[0] + "," + p1[1] + "),ST_MakePoint(" + p2[0] + "," + p2[1] + "),'SPHEROID[\"WGS 84\",6378137,298.257223563]')", function(err, distance) {
          if (err) {
            console.log('error during getCost', err);
            defer.reject(err);
          }
          if (distance.rows[0].st_distance_spheroid !== 0) {
            len = (distance.rows[0].st_distance_spheroid);
            sin_theta = ((+elevation[k + 1]) - (+elevation[k])) / len;
            to_cost += (Math.asin(sin_theta) * (180 / Math.PI) + 90) * len;
            rev_cost += (Math.asin(sin_theta * -1) * (180 / Math.PI) + 90) * len;
          }
          count++;
          // console.log(k, 'distance: ', distance.rows[0])
          if (count === (stringArr.length - 1)) {
            // console.log('elevation: ', elevation, 'to_cost: ', to_cost, 'rev_cost: ', rev_cost);
            defer.resolve({
              index: param.index,
              to_cost: to_cost,
              rev_cost: rev_cost
            });
            console.log('getCosts end i', param.index);
          }
        });
      })(k)
    }
  }
  return defer.promise;
}

// ST_Distance_Spheroid has better performance than ST_Distance
