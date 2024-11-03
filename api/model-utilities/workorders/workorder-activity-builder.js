const {
  WorkOrderStateChangeManager
} = require('./workorder-state-change-manager');

class WorkOrderActivityBuilder extends WorkOrderStateChangeManager {
  _activities = [];
  constructor(wo, toState, user) {
    super(wo, toState, user);
  }

  get items() {
    return this.wo.items || [];
  }

  get activities() {
    return this._activities;
  }

  set activities(activities) {
    this._activities = activities;
  }

  applyActivitiesToWorkorder(buildActivities = []) {
    const filteredActivities = buildActivities.map(a => this.getId(a));
    this.activities.push(...filteredActivities);
    return WorkOrder.update(
      { id: this.getId(this.wo) },
      { activities: this.activities }
    );
  }

  async buildActivityTemplates(activityTemplates = [], item = {}) {
    const builtActivities = [];
    for (let i = 0; i < activityTemplates.length; i++) {
      const activityTemplate = activityTemplates[i];
      const build = await WorkOrderActivity.buildFromTemplate(
        activityTemplate,
        item,
        this.wo
      );
      builtActivities.push(build);
    }
    return builtActivities;
  }

  async generateActivityWork(activities = []) {
    const builtActivities = [];
    for (let i = 0; i < activities.length; i++) {
      const activityID = this.getId(activities[i]);
      const template = await WorkOrderTemplate.findOneById(activityID).populate(
        'tasks'
      );
      builtActivities.push(template);
    }
    return builtActivities;
  }

  async iterateSerialContent(item) {
    const serialContent = item.serial_content || {};
    for (const sku in serialContent) {
      const serial = serialContent[sku];
      const activityTemplates = await this.generateActivityWork(
        serial.activities
      );
      const activities = await this.buildActivityTemplates(
        activityTemplates,
        item
      );
      await this.applyActivitiesToWorkorder(activities);
    }
  }

  async iterateItems() {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      await this.iterateSerialContent(item);
    }
  }

  async execute() {
    await this.iterateItems();
  }
}

module.exports = { WorkOrderActivityBuilder };
