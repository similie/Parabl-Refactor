module.exports = {
  migrate: (process.env.MIGRATION || 'safe'),
  attributes: {
    workorder: {
      model: 'workorder'
    },
    activity: {
      model: 'activity'
    }
  },

};
