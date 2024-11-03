const { EnvAuthManager } = require('../../common/env-manager');
const {
  SQSCommManager,
  SQSCommQueues
} = require('../../external-comms/sqs-comm-manager');

class DeviceActionBroadcast {
  _deviceAction;
  _sqsManager;
  constructor(deviceAction) {
    this.deviceAction = deviceAction;
    this._sqsManager = new SQSCommManager();
  }

  get deviceAction() {
    return this._deviceAction;
  }

  set deviceAction(deviceAction) {
    this._deviceAction = deviceAction;
  }

  get confirmationMessageAttributes() {
    if (!this.deviceAction) {
      throw new Error('A Device Action Model Is Requred');
    }
    const params = {
      // Remove DelaySeconds parameter and value for FIFO queues
      MessageAttributes: {},
      MessageBody: JSON.stringify(this.deviceAction),
      MessageDeduplicationId: `device-action-signapore-${Model.getId(
        this.deviceAction
      )}`, // Required for FIFO queues
      MessageGroupId: EnvAuthManager.siteStaticId, // Required for FIFO queues
      QueueUrl: SQSCommQueues.DeviceActionProcessor
    };
    return params;
  }

  /**
   *
   *
   */
  async send() {
    try {
      const result = await this._sqsManager.send(
        this.confirmationMessageAttributes
      );
      return result;
    } catch (e) {
      sails.log.error(e);
      return false;
    }
  }
}

module.exports = { DeviceActionBroadcast };
