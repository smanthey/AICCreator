"use strict";

const { TASK_ROUTING, isKnownTaskType } = require("../config/task-routing");

function listKnownTaskTypes() {
  return Object.keys(TASK_ROUTING).sort((a, b) => a.localeCompare(b));
}

module.exports = {
  isKnownTaskType,
  listKnownTaskTypes,
};
