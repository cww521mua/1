export {};
const sharedState = require('./shared-state');
const globalConfig = require('./global-config');
const accountConfig = require('./account-config');
const accounts = require('./accounts');
const brandIcon = require('./brand-icon');
const mengkaBindings = require('./mengka-bindings');

module.exports = {
    // Account config
    getConfigSnapshot: accountConfig.getConfigSnapshot,
    applyConfigSnapshot: accountConfig.applyConfigSnapshot,
    getAutomation: accountConfig.getAutomation,
    setAutomation: accountConfig.setAutomation,
    isAutomationOn: accountConfig.isAutomationOn,
    getPreferredSeed: accountConfig.getPreferredSeed,
    getPlantingStrategy: accountConfig.getPlantingStrategy,
    getBagSeedPriority: accountConfig.getBagSeedPriority,
    getBagSeedMultiLandReservationEnabled: accountConfig.getBagSeedMultiLandReservationEnabled,
    getBagSeedLandTypes: accountConfig.getBagSeedLandTypes,
    getBagSeedFallbackStrategy: accountConfig.getBagSeedFallbackStrategy,
    getIntervals: accountConfig.getIntervals,
    getFriendQuietHours: accountConfig.getFriendQuietHours,
    getKnownFriendGids: accountConfig.getKnownFriendGids,
    setKnownFriendGids: accountConfig.setKnownFriendGids,
    getKnownFriendGidSyncCooldownSec: accountConfig.getKnownFriendGidSyncCooldownSec,
    setKnownFriendGidSyncCooldownSec: accountConfig.setKnownFriendGidSyncCooldownSec,
    getFriendsListCacheTtlSec: accountConfig.getFriendsListCacheTtlSec,
    setFriendsListCacheTtlSec: accountConfig.setFriendsListCacheTtlSec,
    getFriendBlacklist: accountConfig.getFriendBlacklist,
    setFriendBlacklist: accountConfig.setFriendBlacklist,
    addFriendToBlacklist: accountConfig.addFriendToBlacklist,
    getStealDelaySeconds: accountConfig.getStealDelaySeconds,
    getPlantOrderRandom: accountConfig.getPlantOrderRandom,
    getPlantDelaySeconds: accountConfig.getPlantDelaySeconds,
    getFertilizerBuyOrganicCount: accountConfig.getFertilizerBuyOrganicCount,
    getFertilizerBuyOrganicThresholdHours: accountConfig.getFertilizerBuyOrganicThresholdHours,
    getFertilizerBuyNormalCount: accountConfig.getFertilizerBuyNormalCount,
    getFertilizerBuyNormalThresholdHours: accountConfig.getFertilizerBuyNormalThresholdHours,
    getFertilizerBuyCheckIntervalMinutes: accountConfig.getFertilizerBuyCheckIntervalMinutes,
    getAutoAcceptFriendMinLevel: accountConfig.getAutoAcceptFriendMinLevel,
    getAutoAcceptRequireOwnLevel: accountConfig.getAutoAcceptRequireOwnLevel,
    getAutoAcceptHarvestStealEnabled: accountConfig.getAutoAcceptHarvestStealEnabled,
    getAutoAcceptHarvestStealHarvest: accountConfig.getAutoAcceptHarvestStealHarvest,
    getAutoAcceptHarvestStealSteal: accountConfig.getAutoAcceptHarvestStealSteal,
    getPlantBlacklist: accountConfig.getPlantBlacklist,
    setPlantBlacklist: accountConfig.setPlantBlacklist,
    getDefaultAccountConfig: accountConfig.getDefaultAccountConfig,

    // Global config
    getUI: globalConfig.getUI,
    setUITheme: globalConfig.setUITheme,
    getLoginSettings: globalConfig.getLoginSettings,
    setLoginSettings: globalConfig.setLoginSettings,
    getOfflineReminder: globalConfig.getOfflineReminder,
    setOfflineReminder: globalConfig.setOfflineReminder,
    getCardSettings: globalConfig.getCardSettings,
    setCardSettings: globalConfig.setCardSettings,
    getBrand: globalConfig.getBrand,
    setBrand: globalConfig.setBrand,
    getMengkaConfig: globalConfig.getMengkaConfig,
    setMengkaConfig: globalConfig.setMengkaConfig,
    findBrandIconFile: brandIcon.findIconFile,
    saveBrandIcon: brandIcon.saveBrandIcon,
    clearBrandIcon: brandIcon.clearBrandIcon,
    getCaptureConfig: globalConfig.getCaptureConfig,
    setCaptureConfig: globalConfig.setCaptureConfig,

    // Accounts
    getAccounts: accounts.getAccounts,
    addOrUpdateAccount: accounts.addOrUpdateAccount,
    deleteAccount: accounts.deleteAccount,

    // Mengka bindings
    getMengkaBindings: mengkaBindings.getMengkaBindings,
    findMengkaBinding: mengkaBindings.findMengkaBinding,
    findMengkaBindingsByOwner: mengkaBindings.findMengkaBindingsByOwner,
    upsertMengkaBinding: mengkaBindings.upsertMengkaBinding,
    deleteMengkaBinding: mengkaBindings.deleteMengkaBinding,

    // System config
    getSystemConfig: globalConfig.getSystemConfig,
    setSystemConfig: globalConfig.setSystemConfig,
};
