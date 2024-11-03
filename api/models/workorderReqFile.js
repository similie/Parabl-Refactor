module.exports = {
  migrate: (process.env.MIGRATION || 'safe'),
  attributes: {
    workorder: {
      model: 'workorder'
    },
    sysfile: {
      model: 'sysfile'
    }
  },

};
