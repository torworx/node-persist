var inflection = require('./inflection');
var Query = require('./query');
var util = require('util');
var events = require("events");

function normalizeType(typeName) {
  return typeName; // TODO: all lower case, verify string, etc.
}

function normalizeColumnDef(columnDef) {
  if(typeof(columnDef) == "string") {
    columnDef = {
      type: normalizeType(columnDef)
    };
  }

  if(!columnDef.defaultValue) {
    columnDef.defaultValue = function() { return null; };
  } else {
    if(typeof(columnDef.defaultValue) != "function") {
      var val = columnDef.defaultValue;
      columnDef.defaultValue = function() { return val; };
    }
  }

  return columnDef;
}

function saveInstance(connection, callback) {
  if(!connection) throw new Error("connection is null or undefined");

  var self = this;
  this._model.emit("beforeSave", this);
  if(this._persisted) {
    self._model.emit("beforeUpdate", self);
    connection.update(this, function() {
      self._model.emit("afterUpdate", self);
      self._model.emit("afterSave", self);
      callback.apply(self, arguments);
    });
  } else {
    this._model.emit("beforeCreate", this);
    connection.save(this, function() {
      self._model.emit("afterCreate", self);
      self._model.emit("afterSave", self);
      callback.apply(self, arguments);
    });
  }
}

function deleteInstance(connection, callback) {
  var self = this;
  this._model.emit("beforeDelete", this);
  var query = new Query(connection, this._model);
  query.where("id = ?", this[this._model.getIdPropertyName()]);
  query.deleteAll(function() {
    self._model.emit("afterDelete", self);
    callback.apply(self, arguments);
  });
}

function getId() {
  return this[this._model.getIdPropertyName()];
}

function addHasManyAssociationMethod(obj, associationName, association) {
  obj.__defineGetter__(associationName, function() {
    if(!obj._connection) {
      return [];
    }
    var query = new Query(obj._connection, association.model);
    return query.where(association.foreignKey + " = ?", obj.getId());
  });
}

function addHasOneAssociationMethod(obj, associationName, association) {
  var foreignKeyName = inflection.propertyName(association.foreignKey);
  obj.__defineGetter__(foreignKeyName, function(){
    var result = null;
    if(obj['_' + foreignKeyName]) {
      result = obj['_' + foreignKeyName];
    }
    if(obj['_' + associationName] && obj['_' + associationName].getId) {
      result = obj['_' + associationName].getId();
    }
    return result;
  });
  obj.__defineSetter__(foreignKeyName, function(val){
    obj['_' + foreignKeyName] = val;
    obj['_' + associationName] = null;
  });
  obj.__defineGetter__(associationName, function() {
    var result = obj['_' + associationName] || null;
    return result;
  });
  obj.__defineSetter__(associationName, function(val) {
    obj['_' + foreignKeyName] = null;
    obj['_' + associationName] = val;
  });
}

function addAssociationMethod(obj, associationName, association) {
  switch(association.type) {
    case "hasMany":
      addHasManyAssociationMethod(obj, associationName, association);
      break;
    case "hasOne":
      addHasOneAssociationMethod(obj, associationName, association);
      break;
    default:
      throw new Error("Invalid association type '" + association.type + "'");
  }
}

function addAssociationMethods(obj) {
  for(var associationName in obj._model.associations) {
    var association = obj._model.associations[associationName];
    addAssociationMethod(obj, associationName, association);
  }
}

function copyValuesIntoObject(values, obj) {
  for(var valKey in values) {
    var setter = obj.__lookupSetter__(valKey);
    if(setter) {
      setter(values[valKey]);
    } else {
      obj[valKey] = values[valKey];
    }
  }
}

function createColumnPropertiesOnObject(obj) {
  for(var columnName in obj._model.columns) {
    var column = obj._model.columns[columnName];
    if(!obj[columnName]) {
      if(!column.foreignKey) {
        obj[columnName] = column.defaultValue();
      }
    }
  }
}

function addColumn(propertyName, columnDef) {
  var col = normalizeColumnDef(columnDef);
  if(!col.dbColumnName) col.dbColumnName = propertyName;
  this.columns[propertyName] = col;
};

function getIdPropertyName() {
  for(var name in this.columns) {
    if(this.columns[name].primaryKey) {
      return name;
    }
  }
  return null;
}

function hasMany(model) {
  var name = inflection.propertyName(inflection.pluralize(model.modelName));
  this.associations[name] = { type: "hasMany", model: model, foreignKey: this.modelName + 'Id' };

  name = inflection.propertyName(this.modelName);
  if(!model.associations[name]) {
    model.associations[name] = { type: "hasOne", model: this, foreignKey: this.modelName + 'Id' };
  }
  var foreignKeyName = inflection.propertyName(this.modelName + 'Id');
  model.addColumn(foreignKeyName, { type: "int", foreignKey: true });

  return this;
};

function hasOne(model) {
  var name = inflection.propertyName(model.modelName);
  this.associations[name] = { type: "hasOne", model: model, foreignKey: this.modelName + 'Id' };

  name = inflection.propertyName(inflection.pluralize(this.modelName));
  if(!model.associations[name]) {
    model.associations[name] = { type: "hasMany", model: this, foreignKey: this.modelName + 'Id' };
  }

  return this;
};

function using(connection) {
  return new Query(connection, this);
};

function ensurePrimaryKeyColumn(model) {
  // todo: only add if they haven't defined one yet
  model.addColumn("id", { type: "integer", primaryKey: true, autoIncrement: true });
}

function addColumns(model, columnDefs) {
  for(var propertyName in columnDefs) {
    model.addColumn(propertyName, columnDefs[propertyName]);
  }
  ensurePrimaryKeyColumn(model);
}

exports.define = function(name, columnDefs) {
  var Model = function(values) {
    var self = this;
    this._model = Model;
    this.save = saveInstance;
    this.delete = deleteInstance;
    this.getId = getId;

    addAssociationMethods(this);
    if(values) {
      copyValuesIntoObject(values, this);
    }
    createColumnPropertiesOnObject(this);

    return this;
  };

  Model.modelName = name;
  Model.associations = {};
  Model.columns = {};

  Model.eventEmmiter = new events.EventEmitter();
  for(var n in events.EventEmitter.prototype) {
    Model[n] = events.EventEmitter.prototype[n];
    /*
    Model[n] = function() {
      Model.eventEmmiter.apply(Model.eventEmmiter, arguments);
    }*/
  }

  Model.addColumn = addColumn;
  Model.getIdPropertyName = getIdPropertyName;
  Model.hasMany = hasMany;
  Model.hasOne = hasOne;
  Model.using = using;

  addColumns(Model, columnDefs);

  return Model;
}
