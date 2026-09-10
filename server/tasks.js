import { InMemoryTaskStore } from './task-store.js';

let _store = null;

export function initTaskStore(store) {
  _store = store;
}

export function getStore() {
  if (!_store) {
    _store = new InMemoryTaskStore();
  }
  return _store;
}

export function createTask(type, metadata = {}) {
  return getStore().createTask(type, metadata);
}

export function getTask(id) {
  return getStore().getTask(id);
}

export function updateTask(id, patch) {
  return getStore().updateTask(id, patch);
}

export function cancelTask(id) {
  return getStore().cancelTask(id);
}

export function isTaskCancelled(id) {
  return getStore().isTaskCancelled(id);
}

export function listTasks() {
  return getStore().listTasks();
}

export function cleanupTasks(maxAge = 3600000) {
  return getStore().cleanup(maxAge);
}
