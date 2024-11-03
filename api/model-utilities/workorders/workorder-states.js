const states = {
  INITIATED: 'INITIATED',
  APPROVED: 'approved',
  PENDING: 'pending',
  RECEIVED: 'received',
  REJECTED: 'rejected',
  ACCEPTED: 'accepted',
  DELIVERED: 'delivered',
  INPROGRESS: 'inprogress',
  RETIRED: 'retired',
  TRANSFERED: 'transfered',
  COMPLETED: 'completed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
  SCHEDULED: 'scheduled',
  CLOSED: 'closed'
};

const WOModes = {
  MAINTENANCE: 'maintenance',
  BYPRODUCT: 'byproduct'
};

const WOActivityStates = {
  REJECTED: -2,
  PENDING: -1,
  STARTED: 0,
  INCOMPLETE: 1,
  ONHOLD: 2,
  COMPLETE: 3
};

const WOActivityStatesIndices = {
  '-2': 'REJECTED',
  '-1': 'PENDING',
  0: 'STARTED',
  1: 'INCOMPLETE',
  2: 'ONHOLD',
  3: 'COMPLETE'
};

function checkForState(state = states.INITIATED) {
  if (!states[state]) {
    return states.CANCELLED;
  }
  return states[state];
}

module.exports = {
  states,
  checkForState,
  WOModes,
  WOActivityStatesIndices,
  WOActivityStates
};
