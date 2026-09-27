const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  terrariums: {
    list: call('terrariums:list'),
    create: call('terrariums:create'),
    update: call('terrariums:update'),
    sell: call('terrariums:sell'),
    unsell: call('terrariums:unsell'),
    remove: call('terrariums:delete'),
  },
  photos: {
    set: call('photos:set'),
  },
  buyers: {
    list: call('buyers:list'),
    update: call('buyers:update'),
    remove: call('buyers:delete'),
  },
  contact: {
    whatsapp: call('contact:whatsapp'),
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
  },
  data: {
    info: call('data:info'),
    openFolder: call('data:openFolder'),
    backup: call('data:backup'),
    restore: call('data:restore'),
  },
  catalog: {
    export: call('catalog:export'),
  },
});
