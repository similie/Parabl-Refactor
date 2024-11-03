const poStates = () => {
  const poStates = {
    PENDING: 'pending',
    EVALUATING: 'evaluating',
    REJECTED: 'rejected',
    APPROVED: 'approved',
    PROCESSING: 'processing',
    SHIPPED: 'shipped',
    RECEIVED: 'received',
    COMPLETE: 'complete',
    TIMEOUT: 'timeout'
  };
  return poStates;
};

module.exports = {
  poStates
};
