/**
 * InventoryTransfer.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {

  attributes: {

    schema: {
        model: 'nodeschema'
    },

    from_station: {
        model: 'station'
    },

    to_station: {
        model: 'station'
    },

    from_node: {
        type: 'integer'
    },

    to_node: {
        type: 'integer'
    },

    approved_by: {
        model: 'user'
    },

    initiated_by: {
        model: 'user'
    },

    from_user: {
        model: 'user'
    },

    from_value: {
        type: 'integer'
    },

    to_value: {
        type: 'integer'
    },

    serial_from: {
        type: 'uuid'
    },

    serial_to: {
        type: 'uuid'
    },

    meta: {
        type: 'json'
    }

    //  ╔═╗╦═╗╦╔╦╗╦╔╦╗╦╦  ╦╔═╗╔═╗
    //  ╠═╝╠╦╝║║║║║ ║ ║╚╗╔╝║╣ ╚═╗
    //  ╩  ╩╚═╩╩ ╩╩ ╩ ╩ ╚╝ ╚═╝╚═╝


    //  ╔═╗╔╦╗╔╗ ╔═╗╔╦╗╔═╗
    //  ║╣ ║║║╠╩╗║╣  ║║╚═╗
    //  ╚═╝╩ ╩╚═╝╚═╝═╩╝╚═╝


    //  ╔═╗╔═╗╔═╗╔═╗╔═╗╦╔═╗╔╦╗╦╔═╗╔╗╔╔═╗
    //  ╠═╣╚═╗╚═╗║ ║║  ║╠═╣ ║ ║║ ║║║║╚═╗
    //  ╩ ╩╚═╝╚═╝╚═╝╚═╝╩╩ ╩ ╩ ╩╚═╝╝╚╝╚═╝

  },

};

