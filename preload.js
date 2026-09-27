const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  terrariums: {
    list: call('terrariums:list'),
    create: call('terrariums:create'),
    update: call('terrariums:update'),
    settle: call('terrariums:settle'),
    unsell: call('terrariums:unsell'),
    remove: call('terrariums:delete'),
  },
  photos: {
    set: call('photos:set'),
  },
  jars: {
    list: call('jars:list'),
    create: call('jars:create'),
    update: call('jars:update'),
    remove: call('jars:delete'),
  },
  buyers: {
    list: call('buyers:list'),
    update: call('buyers:update'),
    remove: call('buyers:delete'),
  },
  contact: {
    whatsapp: call('contact:whatsapp'),
    instagram: call('contact:instagram'),
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
    importSheetPreview: call('data:importSheetPreview'),
    importSheetApply: call('data:importSheetApply'),
    exportCsv: call('data:exportCsv'),
  },
  catalog: {
    export: call('catalog:export'),
  },
});
