'use strict';

var genericPool = require('generic-pool');
var path = require('path');
var fs = require('fs');

var existsSync = fs.existsSync || path.existsSync;

module.exports = exports = Connector;

function Connector(settings) {
  this.name = settings.driver;
  this.settings = settings;

  var name = settings.driver;
  // and initialize schema using driver
  // this is only one initialization entry point of driver
  // this module should define `driver` member of `this` (schema)
  var Driver;
  if (typeof name === 'function') {
    Driver = name;
    this.name = Driver.name;
  } else if (name.match(/^\//)) {
    // try absolute path
    Driver = require(name);
  } else if (existsSync(__dirname + '/drivers/' + name + '.js')) {
    // try built-in driver
    Driver = require('./drivers/' + name);
  } else {
    // try foreign driver
    try {
      Driver = require('persist-' + name);
    } catch (e) {
      return console.log('\nWARNING: Persist driver "' + name + '" is not installed,\nso your models would not work, to fix run:\n\n    npm install persist-' + name, '\n');
    }
  }

  this.driver = new Driver();

  if (settings.pooling) {
    this.pool = this.createPool(settings.pooling);
  }
  return this;
}

Connector.prototype.createPool = function (factory) {
  var self = this;
  var pool;
  factory.create = function (callback) {
    if (self.settings.trace) {
      console.log('pooling create');
    }
    return self.driver.connect(self.settings, function (err, conn) {
      if (err) {
        return callback(err);
      }
      conn.getPool = function () {
        return pool;
      };
      conn.oldClose = conn.close;
      conn.close = function () {
        if (self.settings.trace) {
          console.log('pooling release');
        }
        return pool.release(conn);
      };
      return callback(null, conn);
    });
  };
  factory.destroy = function (conn) {
    if (self.settings.trace) {
      console.log('pooling destroy');
    }
    conn.oldClose();
  };
  pool = genericPool.Pool(factory);
  return pool;
};

Connector.prototype.connect = function (callback) {
  callback = callback || function() {};
  if (this.pool) {
    return this.pool.acquire(callback);
  } else {
    return this.driver.connect(this.settings, callback);
  }
}


Connector.prototype.shutdown = function(callback) {
  callback = callback || function() {};
  if (!this.pool) return callback();
  var pool = this.pool;
  return pool.drain(function() {
    pool.destroyAllNow(callback);
  });
};