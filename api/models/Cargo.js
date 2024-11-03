/**
 * Cargo.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    purchase_order: {
      model: "purchaseorder"
    },

    tracking_id: {
      unique: true,
      type: "string"
    },

    vehicle: {
      model: "station"
    },

    vehicle_driver: {
      model: "user"
    },

    vehicle_mileage: {
      type: "integer"
    },
    // station_id, to match po
    from_station: {
      type: "string"
    },
    // station_id
    to_station: {
      type: "string"
    },

    start_fuel_gauge: {
      type: "integer"
    },

    end_fuel_gauge: {
      type: "integer"
    },

    package_unload_time: {
      type: "datetime"
    },

    items: {
      type: "array"
    },

    length: {
      type: "integer",
      defaultsTo: 0
    },

    width: {
      type: "integer",
      defaultsTo: 0
    },

    height: {
      type: "integer",
      defaultsTo: 0
    },

    weight: {
      type: "integer",
      defaultsTo: 0
    },

    // 0  completed
    // 1  inprogress
    // 2  scheduled
    progress: {
      type: "integer",
      defaultsTo: 1
    },

    scheduled_date: {
      type: "datetime"
    },

    packed_by: {
      model: "user"
    },

    received_by: {
      model: "user"
    }
  },

  progress: value => {
    const progress = {
      completed: 0,
      inprogress: 1,
      scheduled: 2
    };

    if (value) {
      return progress[value];
    }
    // clone it
    return {
      ...progress
    };
  },

  beforeUpdate: async function(values, next) {
    if (values.vehicle_mileage && values.id) {
      const cargo = await Cargo.findOneById(values.id).populate("vehicle");
      if (!cargo.vehicle) {
        return next();
      }

      const stationType = await StationSchema.findOneById(
        cargo.vehicle.station_type
      );

      if (!stationType) {
        return next();
      }
      const schema = stationType.schema;
      const helpers = Module._helpers.logistics("vehicle_parameter");
      const logParams = helpers.logParams(schema);
      const od = logParams("odometer");
      cargo.vehicle.schema[od] = values.vehicle_mileage;
      Station.update(
        {
          id: Station.getId(cargo.vehicle)
        },
        {
          schema: cargo.vehicle.schema
        }
      ).exec(err => {
        if (err) {
          sails.log.error(err);
        }
      });
    }

    next();
  }
};
