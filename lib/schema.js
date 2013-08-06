'use strict';

var async = require('async');
var dbInfo = require('db-info');
var Connector = require('./connector');
var Model = require('./model');
var inflection = require('./inflection');

module.exports = exports = Schema;

function Schema(settings) {
  this.settings = settings;
  this.models = {};
  if (settings.connector) {
    this.connector = settings.connector;
  } else {
    this.connector = new Connector(settings);
  }
  this.delegateFormConnection(['runSql', 'runSqlAll', 'runSqlEach', 'runSqlFromFile', 'runSqlAllFromFile', 'runSqlEachFromFile']);
}
/** @private **/
Schema.prototype.delegateFormConnection = function (functions) {
  var self = this;
  functions.forEach(function (fn) {
    self[fn] = createConnectionDelegate(fn);
  });
  function createConnectionDelegate(fnName) {
    return function() {
      var conn = arguments[0];
      if (conn && conn.driver && conn.db) {
        return conn[fnName].apply(conn, Array.prototype.slice.call(arguments, 1));
      } else {
        return self.connect(function (conn) {
          return conn[fnName].apply(conn, Array.prototype.slice.call(arguments, 0));
        });
      }
    }
  }
};

Schema.prototype.define = function(name, columnDefs, opts) {
  var model =  Model.define(name, columnDefs, opts);
  this.models[name] = model;
  return model;
};


Schema.prototype.asyncQueue = function() {
  if (!this.q) this.q = async.queue(function(task, callback) {
    dbInfo.getInfo(task, function(err, result) {
      if (err) {
        console.log(err);
      }
      callback(err, result);
    });
  }, 2);
  return this.q;
};

Schema.prototype.defineAuto = function(name, options, callback) {
  var pluralName = inflection.pluralize(name);
  this.asyncQueue().push(options, function(err, result) {
    if (result.tables.hasOwnProperty(pluralName)) {
      var columnDefs = result.tables[pluralName].columns;
      var model = Model.define(name, columnDefs);
      this.models[name] = model;
      callback(null, model);
    }
  });
};

Schema.prototype.waitForDefinitionsToFinish = function(callback) {
  if (this.asyncQueue().length() > 0) {
    this.asyncQueue().drain = callback;
  } else {
    callback();
  }
};

Schema.prototype.connect = function (callback) {
  return this.connector.connect(callback);
};

Schema.prototype.shutdown = function (callback) {
  return this.connector.shutdown(callback);
}
