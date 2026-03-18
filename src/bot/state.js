const userState = {};

function getUserState(senderId) {
  return userState[senderId];
}

function setUserState(senderId, state) {
  userState[senderId] = state;
}

function clearUserState(senderId) {
  delete userState[senderId];
}

module.exports = { getUserState, setUserState, clearUserState };
